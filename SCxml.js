/*
SCxml is the main object of this library.
It must be instantiated for each SCXML document.


JSSCxml provides a function (SCxml.parseSCXMLTags) for automatically
creating SCxml instances from the src attribute of every <scxml> element
in the main Webpage.

Otherwise, you can simply create an interpreter like this:
	new SCxml(uriOfYourScxmlDocument)


Some large methods are defined in separate files.
They must be included along SCxml.js:

xhr.js				wraps HTTP communication
structures.js		some specific, optimized SCXML preprocessing
SCxmlProcessors.js	implements Event IO Processors
SCxmlScript.js		the ECMAscript execution wrapper iframe
SCxmlEvent.js		authors may want to read that one
SCxmlExecute.js		implements executable content
*/

// for now, source can only be a URI
function SCxml(source, htmlContext)
{
	this.dom=null
	
	this.internalQueue=[]
	this.externalQueue=[]
	
	this.configuration={}
	this.statesToEnter=null
	
	this.sid=SCxml.sessions.length
	SCxml.sessions.push(this)
	this.html=htmlContext||window.document.documentElement
	
	this.initIframe()
	
	this.running=false
	this.stable=false

	// use just the filename for messages, URI can be quite long
	this.name="session "+this.sid

	if(source instanceof Element)
	{
		var ns=source.getAttribute("xmlns")
		var d=document.implementation.createDocument(ns, "scxml", null)
		for(var i=0, a; a=source.attributes[i]; i++)
			d.documentElement.setAttribute(a.name, a.value)
		for(var c; c=source.firstElementChild;)
			d.documentElement.appendChild(d.adoptNode(c, true))
		setTimeout(function(sc, dom){ sc.interpret(dom) }, 0, this, d)
	}
	else if(/^\s*</.test(source))
	{
		var d=new DOMParser().parseFromString(source, "application/scxml+xml")
		setTimeout(function(sc, dom){ sc.interpret(dom) }, 0, this, d)
	}
	else
	{
		this.name=source.match(/[^/]+\.(?:sc)?xml/)[0]
		new XHR(source, this, this.xhrResponse, null, this.xhrFailed)
	}
}

SCxml.sessions=[null]

/*
Instantiates an SCxml() for each <scxml> in the HTML document,
and references it in an "interpreter" property of the
corresponding <scxml> element
*/
SCxml.parseSCXMLTags=function ()
{
	var tags=document.getElementsByTagName("scxml")
	for(var i=0; i<tags.length; i++)
	{
		if(tags[i].hasAttribute("src"))
			tags[i].interpreter=new SCxml(tags[i].getAttribute("src"), tags[i])
		else
			tags[i].interpreter=new SCxml(tags[i], tags[i])
	}
}

SCxml.prototype={
	toString: function(){ return "SCxml("+this.name+")" },
	constructor: SCxml,

	// XHR callbacks
	xhrResponse: function(xhr){ this.interpret(xhr.req.responseXML) },
	xhrFailed: function(xhr)
	{
		// the Webkit generates a perfectly good error message
		// when an XHR fails: no need to throw another on top
	},
	
	validate: function validate()
	{
		if(!this.dom)
			throw "Failed to load SCXML because of malformed XML."
		// TODO: much more validation
		with(this.dom.documentElement)
		{
			if(tagName!="scxml")
				throw this.dom.documentURI+" is not an SCXML document"
			if(namespaceURI!="http://www.w3.org/2005/07/scxml")
				console.warn(this.dom.documentURI+" is not a valid SCXML document (missing or incorrect xmlns)")
			if(hasAttribute("datamodel")
			&& getAttribute("datamodel") != "ecmascript")
				throw "'"+getAttribute("datamodel")+"' datamodel in "
				+ this.dom.documentURI +" is not supported by JSSCxml"
			if(hasAttribute("binding")
			&& getAttribute("binding") != "early"
			&& getAttribute("binding") != "late")
				console.warn("binding='"+getAttribute("binding")+"' in"
				+ this.dom.documentURI +" is not valid")
			this.lateBinding=(getAttribute("binding")=="late")
			this.datamodel._name=getAttribute("name")
		}
		
		with(this.dom)
		{
			var states=querySelectorAll("state, final, parallel, history")
			for(var i=0, state; state=states[i]; i++)
			// generate an ID for states that don't have one
				if(!state.hasAttribute('id'))
					state.setAttribute('id', this.uniqId())
			
			var testId=querySelector("[id]")
			if(getElementById(testId.getAttribute("id"))==null)
			// happens in Firefox, very annoying, so it's best to replace it
				getElementById=function(id)
				{ return querySelector("[id="+id+"]") }
		}
	},

	// creates a unique ID guaranteed not to occur in the same SCXML
	uniqId: function ()
	{
		var id
		do{
			id="__generated_id_"+Math.floor(Math.random()*1000000)
		}while(this.dom.getElementById(id))
		return id
	},
	
	getById: function(id){
		var s=this.dom.getElementById(id)
		if(!s) throw this.name+": transition target "+id+" not found"
		return s
	},
	
	// get started with the parsed SCXML
	interpret: function(dom)
	{
		this.dom=dom
		this.validate()
		
		var lb=this.lateBinding // just temporarily forget this
		this.lateBinding=true	// to let execute() do its job
		
		// interpret top-level <datamodel> and scripts if present
		var d=dom.querySelector("scxml > datamodel")
		if(d) try{this.execute(d)} catch(err){}

		d=dom.querySelectorAll("scxml > script")
		for(var i=0; i<d.length; i++)
			try{this.wrapScript(d[i].textContent,d[i])} catch(err){}


		// interpret other <datamodel>s, but do not assign if binding="late"
		d=dom.querySelectorAll("scxml > * datamodel")
		for(var i=0; i<d.length; i++)
		{
			if(lb)
				try{this.declare(d[i])} catch(err){}
			else
				try{this.execute(d[i])} catch(err){}
		}
		// now restore lateBinding
		this.lateBinding=lb
		
		this.running=true
		console.log("The interpreter for "+this.name+" is now ready.")
		
		var init=this.firstState(dom.documentElement)
		// and... enter !
		if(!init) throw this.name + " has no suitable initial state."
		if(init instanceof Array) this.addStatesToEnter( init )
		else this.addStatesToEnter( [init] )
		this.statesToEnter.inEntryOrder().forEach(this.enterState,this)
		this.mainEventLoop()
	},
	
	// find the initial state in the document or in a <state>;
	// returns null or undefined if the state is atomic or parallel
	firstState: function(parent)
	{
		if(parent.tagName!="state" && parent.tagName!="scxml")
			return null
		
		var id, state
		if(parent.hasAttribute("initial"))
		{
			state=parent.getAttribute("initial").split(/\s+/)
				.map(this.getById, this)
			if(state.length==1 || parent.tagName=="state") return state[0]
		}

		else if(state=this.dom.querySelector("[id="+parent.getAttribute("id")
			+"] > initial"))
		{
			var trans=state.firstElementChild
			while(trans && trans.tagName!="transition")
				trans=trans.nextElementSibling
			if(!trans)
				throw this.name+": <initial> requires a <transition>."
			parent.executeAfterEntry=trans
			state=this.dom.getElementById(id=trans.getAttribute("target"))
		}
		else
		{
			state=parent.firstElementChild
			while(state && !(state.tagName in SCxml.STATE_ELEMENTS))
				state=state.nextElementSibling
		}
		return state
	},
	
	addStatesToEnter: function(states)
	{
	for(var i=0, state; state=states[i]; i++)
	{
		if(state.tagName=="history")
		{
			var h
			if("record" in state)
				h=state.record
			else // use the transition by default
			{
				var trans=state.firstElementChild
				while(trans && trans.tagName!="transition")
					trans=trans.nextElementSibling
				if(!trans)
					throw this.name+": <history> requires a default <transition>."
				// transition content must be run after parent's onentry
				// but before entering any children
				state.parentNode.executeAfterEntry=trans
				h=trans.getAttribute("target").split(/\s+/)
					.map(this.getById,this)
			}
			this.addStatesToEnter(h)
		}
		else this.statesToEnter=this.walkToEnter(state, this.statesToEnter)
	}
	},
	
	walkToEnter: function(state, tree)
	{
		var path=[]
		
		var id=state.getAttribute('id')

		path.push(state)
		var down=state, up=state
		while(down = this.firstState(down))
			path.push(down)
		while((up = up.parentNode).tagName=="state")
			path.unshift(up)
		
		var ct=new CompiledTree(new CompiledPath(path))
		
		if(!ct.root.atomic)
		{
			var c=ct.root.end.firstElementChild
			while(c){ if(c.tagName in SCxml.STATE_ELEMENTS)
				{
					
					if(tree && tree.root.path[0]==c)
						ct.appendChild(tree)
					else
						this.walkToEnter(c,ct)
				}
				c=c.nextElementSibling
			}
		}
		
		// this happens when climbing deeper into the tree
		// or when there are multiple target states
		if(tree && tree.attach(ct))
			return tree

		// else, clim up to the root
		while(ct.root.parent.tagName!="scxml")
			ct=this.walkToEnter(ct.root.parent, ct)
		
		return ct
	},
	
	// add to the configuration, run the onentry stuff
	enterState: function(state)
	{
		var id=state.getAttribute('id')
		if(id in this.configuration){ delete state.executeAfterEntry; return }
		this.configuration[id]=state
		state.setAttribute("active",true)
		
		var onentry=this.dom.querySelectorAll("[id="+id+"] > onentry")
		if(state.executeAfterEntry)
		{
			onentry[onentry.length]=state.executeAfterEntry
			delete state.executeAfterEntry
		}
		for(var i=0; onentry[i]; i++)
			try{this.execute(onentry[i])}
			catch(err){}
		
		state.fin=true
		if(state.tagName=="final")
			this.finalState(state.parentNode)
	},

	finalState: function(state)
	{
		if(state.tagName=="scxml")
		{
			this.running=false
			this.stable=true
			console.log(this.name+" reached top-level final state: Terminated.")
			return
		}
		
		if(state.tagName=="parallel")
			for(var c=state.firstElementChild; c; c=c.nextElementSibling)
				if(c.tagName in SCxml.STATE_ELEMENTS && !c.fin) return;
		
		state.fin=true
		var id=state.getAttribute('id')
		this.internalQueue.push(new SCxml.Event("done.state."+id))
		if(state.parentNode.tagName=="parallel")
			this.finalState(state.parentNode)
	},

	findLCCA: function(source, targets)
	{
		if(targets==null) return null // targetless
		var LCCA=source
		var ids=targets.map(function (e){
				if(e.tagName=="history") e=e.parentNode
				return "[id="+e.getAttribute("id")+"]"})
			.join(", ")
		// determine transition type
		var internal=(source.querySelectorAll(ids).length==targets.length)
		
		// get Least Common Compound Ancestor
		if(!internal)
			while((LCCA=LCCA.parentNode)
				.querySelectorAll(ids).length<targets.length );
		
		return LCCA
	},
	
	saveHistory: function(state)
	{
		var id=state.getAttribute('id')
		if(!(id in this.configuration)) return;
		
		var histories=this.dom.querySelectorAll("[id="+id+"] > history")
		for(var i=0, h; h=histories[i]; i++)
		h.record=this.activeChildren(state, h.getAttribute("type")=="deep")
	},
	
	// remove a state from the configuration,
	// and don't forget to run the onexit blocks before
	exitState: function(state)
	{
		var id=state.getAttribute('id')
		if(!(id in this.configuration)) return;
		
		var onexit=this.dom.querySelectorAll("[id="+id+"] > onexit")
		for(var i=0; i<onexit.length; i++)
			try{this.execute(onexit[i])}
			catch(err){}

		delete this.configuration[id]
		state.removeAttribute("active")
	},

	// wrapper for eval, to handle expr and similar attributes
	// that need to be evaluated as ECMAScript
	expr: function(s,el)
	{
		// TODO: check that the expr doesn't do horrible stuff
		return this.datamodel.expr(s,el)
	},
	
	log: console.log,	// easy to override later
	
	// displays errors nicely in the console,
	// including the SCXML element that started it
	// (we can't determine the SCXML line number)
	error: function(name, src, err){
		this.internalQueue.push(new SCxml.Error("error."+name, src, err))
		console.error(err+"\nin SCXML "+this.name+" :", src)
		throw(err)
	},
	
	// returns a list of all transitions for an event (or eventless),
	// in the specified order (see sortedConfiguration below)
	selectTransitions: function(event, conf)
	{
		var that=this
		function test(e)
		{
			if(e.nodeType!=1 || e.tagName!="transition"
			|| (event? !(e.hasAttribute("event") && event.match(e))
				: e.hasAttribute("event"))) return false
			try{ return !e.hasAttribute("cond")
				|| that.expr(e.getAttribute("cond"),e)
			}catch(err) {}
		}
		
		var trans=[]
		
		for(var i=0; i<conf.length; i++) for(var j=0, s; s=conf[i][j]; j++)
		{
			var t=s.firstElementChild
			if(!t) continue
			while(!test(t) && (t=t.nextElementSibling));
			if(t){
				// also prepare a bit (just a bit)
				if(!t.targets) t.targets= t.hasAttribute("target") ?
					t.getAttribute("target").split(/\s+/).map(this.getById,this)
					: null
				trans.push(t)
				break
			}
		}
		
		return trans.length ? this.preemptTransitions(trans) : trans
	},
	
	// a transition preempts another iff it exits the other's source state
	// (it makes sense, and so says a normative section of the spec;
	// I don't care that they made the pseudocode more complicated than that)
	preemptTransitions: function(trans)
	{
		var t=trans[0] // the first one can never be preempted
		t.lcca=this.findLCCA(t.parentNode, t.targets)
		if(trans.length<2) return trans

		var filtered=[trans[0]]
		
		overTransitions:
		for(var i=1; t=trans[i]; i++)
		{
			for(var j=0, p; p=filtered[j]; j++)
				if(t==p || (p.lcca && p.lcca.querySelector(
					"[id="+t.parentNode.getAttribute("id")+"]")))
					continue overTransitions // t is preempted
			t.lcca=this.findLCCA(t.parentNode, t.targets)
			filtered.push(t)
		}
		return filtered
	},
	
	mainEventLoop: function()
	{
		var conf=this.sortedConfiguration()
		
		// first try eventless transition
		var trans=this.selectTransitions(null, conf)
		if(trans.length) return this.takeTransitions(trans)
		
		// if none is enabled, consume internal events
		var event
		while(event=this.internalQueue.shift())
		{
			this.datamodel._event=event
			trans=this.selectTransitions(event, conf)
			if(trans.length) return this.takeTransitions(trans)
		}
		
		// if we reach here, no transition could be used
		this.stable=true
		this.extEventLoop()
	},

	extEventLoop: function()
	{
		var conf=this.sortedConfiguration()
		this.stable=false
		// consume external events
		var event, trans
		while(event=this.externalQueue.shift())
		{
			this.datamodel._event=event
			trans=this.selectTransitions(event,conf)
			if(trans) return this.takeTransitions(trans)
		}
		
		// if we reach here, no transition could be used
		this.stable=true
		console.log(this.name+": waiting for external events.")
	},
	
	// try to follow transitions, after exiting the source states
	takeTransitions: function(trans)
	{
		// first exit all the states that must be exited
		for(var i=trans.length-1, t; t=trans[i]; i--)
		{
			console.log(this.name+": "+t.parentNode.getAttribute("id")
				+" → ["+(t.getAttribute("target")||"*targetless*")+"]")
			
			if(!t.targets) continue
			
			var s=this.dom.createNodeIterator(t.lcca,
				NodeFilter.SHOW_ELEMENT, SCxml.activeStateFilter)
			var rev=[], v
			while(v=s.nextNode()) rev.push(v)
			rev.reverse().forEach(this.saveHistory, this)
			rev.forEach(this.exitState, this)
			s.detach()
		}
		
		// now, between exit and entry, run the executable content if present
		for(i=0; t=trans[i]; i++)
		{
			try{ this.execute(t) }
			catch(err){ throw err }
		}

		this.statesToEnter=null
		// then enter all the states to enter
		for(i=0; t=trans[i]; i++) if(t.targets)
			this.addStatesToEnter(t.targets)
		if(this.statesToEnter)
			this.statesToEnter.inEntryOrder().forEach(this.enterState,this)
		if(this.running) this.mainEventLoop()
	},

	// returns the immediate or deep (atomic) active children
	activeChildren: function(state, deep)
	{
		var active=[]
		var c=this.dom.createTreeWalker(state||this.dom.documentElement,
			NodeFilter.SHOW_ELEMENT, SCxml.activeStateFilter)
		if(!c.firstChild())
			return active
		while(1)
		{
			if(deep) while(c.firstChild()); // dive straight down
			active.push(c.currentNode)
			if(!(deep ? c.nextNode() : c.nextSibling()))
				break
		}
		return active
	},

	// returns an array with all active atomic states, in document order,
	// each followed by their ancestors from child to parent
	// (I humbly suggest the above description to the working group :p)
	sortedConfiguration: function sortedConfiguration()
	{
		function ancestors(c)
		{
			for(var a=[c]; (c=c.parentNode).nodeName!="scxml";) a.push(c)
			return a
		}

		return this.activeChildren(null, true).map(ancestors)
	},
	
	// handles external events
	onEvent:function onEvent(event)
	{
		if(!this.running)
		{
			console.warn(this.name+" has terminated and cannot process more events")
			return
		}
		if(event instanceof Event)
			event=SCxml.ExternalEvent.fromDOMEvent(event)
		this.externalQueue.push(event)
		if(this.stable)
			this.extEventLoop()
	}	
	
}

SCxml.STATE_ELEMENTS={state: 'state', parallel: 'parallel', 'final': 'final'}

SCxml.stateFilter={acceptNode: function(node){ return 2-(node.tagName in SCxml.STATE_ELEMENTS) }}

SCxml.tagNameFilter=function (tagName)
{
	return {acceptNode: function(node)
	{
		if(node.tagName==tagName) return 1
		return 2
	}}
}

SCxml.activeStateFilter={acceptNode: function(node)
{
	if(!(node.tagName in SCxml.STATE_ELEMENTS
	&& node.getAttribute("active")))
		return 2
	return 1
}}
