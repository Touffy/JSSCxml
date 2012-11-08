/*
SCxml is the main object of this library.
It must be instantiated for each SCXML document.


JSSCxml provides a function (SCxml.parseSCXMLTags) for automatically
creating SCxml instances from every <scxml> element in the main Webpage,
using either their "src" attribute or their inline content.

Otherwise, you can simply create an interpreter like this:
	new SCxml(source)


Some large methods are defined in separate files.
They must be included along SCxml.js:

xhr.js				wraps HTTP communication
structures.js		some specific, optimized SCXML preprocessing
SCxmlProcessors.js	implements Event IO Processors
SCxmlDatamodel.js	the datamodel wrapper iframe
SCxmlEvent.js		authors may want to read that one
SCxmlExecute.js		implements executable content
*/

// source can be a URI, an SCXML string or a parsed document
// data is an object whose properties will be copied into the datamodel
function SCxml(source, htmlContext, data, interpretASAP)
{
	this.dom=null
	
	this.interpretASAP=interpretASAP
	this.autoPauseBefore=SCxml.NO_PAUSE
	this.nextPauseBefore=SCxml.NO_PAUSE
	
	this.internalQueue=[]
	this.externalQueue=[]
	
	this.configuration={}
	this.statesToEnter=null
	
	this.sid=SCxml.sessions.length
	SCxml.sessions.push(this)
	if(htmlContext && htmlContext instanceof Element)
		this.html=htmlContext
	else{
		this.html=document.createElement("scxml")
		this.html.interpreter=this
		document.head.appendChild(this.html)
	}
	
	this.initIframe(data)
	
	this.running=false
	this.stable=false
	this.paused=false
	this.readyState=SCxml.LOADING

	this.name="session "+this.sid

	if(source instanceof Document)
		setTimeout(function(sc, dom){ sc.interpret(dom) }, 0, this, source)
	else if(/^\s*</.test(source))
	{
		var d=new DOMParser().parseFromString(source, "application/scxml+xml")
		setTimeout(function(sc, dom){ sc.interpret(dom) }, 0, this, d)
	}
	else
	{
		this.name=source.match(/[^\/]+\.(?:sc)?xml/)[0]
		new XHR(source, this, this.xhrResponse, null, this.xhrFailed)
	}
}
SCxml.sessions=[null]

SCxml.LOADING=0
SCxml.READY=1
SCxml.RUNNING=2
SCxml.FINISHED=3


/*
Instantiates an SCxml() for each <scxml> in the HTML document,
and references it in an "interpreter" property of the
corresponding <scxml> element
*/
SCxml.parseSCXMLTags=function ()
{
	var tags=document.getElementsByTagName("scxml")
	for(var i=0; i<tags.length; i++) tags[i].interpreter
		=new SCxml(tags[i].getAttribute("src"), tags[i], null, true)
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
			
			getElementById=function(id)
			{ return querySelector("state[id="+id+"], final[id="+id+"], history[id="+id+"], parallel[id="+id+"]") }
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
		this.readyState=SCxml.READY
		this.html.dispatchEvent(new Event("ready"))
		
		if(this.interpretASAP) this.start()
	},
	
	start: function()
	{
		if(this.readyState<SCxml.READY) throw this.name+" is not ready yet."
		if(this.readyState>SCxml.READY) throw this.name+" has already started."
		
		var s=this.firstState(this.dom.documentElement)
		// and... enter !
		if(!s) throw this.name + " has no suitable initial state."
		if(s instanceof Array) this.addStatesToEnter( s )
		else this.addStatesToEnter( [s] )
		
		this.statesToEnter.inEntryOrder().forEach(this.enterState,this)
		console.log(this.name+"'s initial configuration: "+this.statesToEnter)
		this.readyState++
		this.mainEventLoop()
	},
	
	pauseNext: function(macrostep)
	{
		this.nextPauseBefore=1-!!macrostep
		if(this.stable) this.pause()
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
			this.readyState=SCxml.FINISHED
			this.html.dispatchEvent(new Event("finished"))
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

	findLCCA: function(trans)
	{
		var source=trans.parentNode, targets=trans.targets
		trans.internal=false
		if(targets==null) return trans.lcca=null // targetless
		trans.lcca=source
		var ids=targets.map(function (e){
				if(e.tagName=="history") e=e.parentNode
				var id=e.getAttribute("id")
				return "state[id="+id+"], final[id="+id+"], history[id="+id+"], parallel[id="+id+"]"})
			.join(", ")
		// determine transition type
		// get Least Common Compound Ancestor
		if(source.querySelectorAll(ids).length==targets.length)
			trans.internal=(trans.getAttribute("type")=="internal")
		else while((trans.lcca=trans.lcca.parentNode)
			.querySelectorAll(ids).length<targets.length );
		if(!trans.internal && trans.lcca==source)
			trans.lcca=trans.lcca.parentNode
		for(var i=0, e; e=targets[i]; i++) if(e==trans.lcca)
			trans.lcca=trans.lcca.parentNode
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
				if(!t.targets){
					if(t.hasAttribute("target"))
						t.targets=t.getAttribute("target")
						.split(/\s+/).map(this.getById,this)
					else if(t.hasAttribute("targetexpr"))
						t.targets=this.expr(t.getAttribute("targetexpr"))
						.toString().split(/\s+/).map(this.getById,this)
					else t.targets=null
				}
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
		this.findLCCA(t)
		if(trans.length<2) return trans

		var filtered=[trans[0]]
		
		overTransitions:
		for(var i=1; t=trans[i]; i++)
		{
			for(var j=0, p; p=filtered[j]; j++)
				if(t==p || (p.lcca && p.lcca.querySelector(
					"[id="+t.parentNode.getAttribute("id")+"]")))
					continue overTransitions // t is preempted
			this.findLCCA(t)
			filtered.push(t)
		}
		return filtered
	},
	
	mainEventLoop: function()
	{
		if(this.nextPauseBefore>=2) return this.pause()
		if(this.autoPauseBefore==2) this.nextPauseBefore=2
		
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

	// NEVER call this directly, use pauseNext() instead
	pause: function()
	{
		if(this.paused || !this.running) return;
		this.paused=true
		this.html.dispatchEvent(new Event("pause"))
		// todo: pause timers
	},
	
	// resume a running SC
	resume: function()
	{
		if(!this.running || !this.paused) return;
		this.nextPauseBefore=0
		this.paused=false
		this.html.dispatchEvent(new Event("resume"))
		this.mainEventLoop()
	},

	extEventLoop: function()
	{
		console.log(this.name+"'s new configuration: "+this.statesToEnter)
		if(this.nextPauseBefore) return this.pause()
		if(this.autoPauseBefore==1) this.nextPauseBefore=1

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
		this.html.dispatchEvent(new Event("waiting", false, false))
	},
	
	// try to follow transitions, after exiting the source states
	takeTransitions: function(trans)
	{
		// first exit all the states that must be exited
		for(var i=trans.length-1, t; t=trans[i]; i--)
		{
			console.log(this.name+": "+t.parentNode.getAttribute("id")
				+" → "+(t.targets?"["+t.targets.map(
					function(e){return e.getAttribute("id")})+"]"
				:"*targetless*"))
			if(!t.targets) continue
			
			var s=this.dom.createNodeIterator(t.lcca,
				NodeFilter.SHOW_ELEMENT, SCxml.activeStateFilter)
			var rev=[], v
			if(s.nextNode()!=t.lcca) rev.push(s.previousNode())
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
		if(this.stable && !this.paused)
			this.extEventLoop()
	}
}

SCxml.prototype.fireEvent=SCxml.prototype.onEvent

SCxml.NO_PAUSE=0
SCxml.EXT_EVENTS=1
SCxml.ALL_EVENTS=2

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
