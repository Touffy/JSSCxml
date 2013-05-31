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
SCxmlInvoke.js		contains most of the <invoke> implementation

If you want <fetch> as well (you probably do), include this:

SCxmlFetch.js		makes XMLHttpRequests available to SCXML documents

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
	this.invoked={}
	this.toInvoke=new Set()
	this.lastEvent=undefined
	
	this.sid=SCxml.sessions.length
	SCxml.sessions.push(this)
	this.html=(htmlContext && htmlContext instanceof Element) ? htmlContext
	 : document.head.appendChild(document.createElement("scxml"))
	this.html.interpreter=this
	
	this.delays={}
	this.timeouts=[]
	this.intervals=[]
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

function getId(element){
	return element.getAttribute("id")
}

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

	timeout: function(args)
	{
		return new Timeout(args, !this.paused, this)
	},
	interval: function(args)
	{
		return new Interval(args, !this.paused, this)
	},

	clean: function()
	{
		if(this.readyState==SCxml.RUNNING) this.terminate()
		delete this.html.interpreter
		if(this.html && this.html.tagName=="scxml")
			this.html.parentNode.removeChild(this.html)
		delete this.html
		
		delete this.datamodel

		document.body.removeChild(this._iframe_)
		delete this._iframe_

		SCxml.sessions[this.sid]=null
		
		if(this.parent) delete this.parent
		delete this.invoked
	},
	terminate: function()
	{
		if(this.readyState<SCxml.RUNNNIG) return;
		
		// exit all active states
		var s=this.dom.createNodeIterator(this.dom.documentElement,
			NodeFilter.SHOW_ELEMENT, SCxml.activeStateFilter)
		var rev=[], v
		while(v=s.nextNode()) rev.push(v)
		rev.reverse()
		if(this.readyState<SCxml.FINISHED) this.sendNoMore=true
		this.html.dispatchEvent(new CustomEvent("exit", {detail:
			{list: rev.filter(this.exitState, this).map(getId)} }))
	
		this.running=false
		
		// fire the done.invoke.id event if there is a parent session
		if(this.readyState>=SCxml.FINISHED && this.parent)
			this.parent.fireEvent(
				new SCxml.ExternalEvent("done.invoke."+this.iid,
				"#_"+this.iid, 'scxml', this.iid, this.donedata))
		delete this.donedata
		this.sendNoMore=true
		this.invokedReady()
	},
	
	restart: function()
	{
		if(this.readyState<SCxml.RUNNING) return;
		if(this.readyState>SCxml.RUNNING) this.terminate()
		if(!this._iframe_)
			throw new Error("Cannot restart a cleaned-up session.")
		
		var s=this.dom.createNodeIterator(this.dom.documentElement,
			NodeFilter.SHOW_ELEMENT, SCxml.stateFilter)
		var v
		while(v=s.nextNode()){
			v.removeAttribute("active")
			v.removeAttribute("willExit")
		}
		
		this.internalQueue=[]
		this.externalQueue=[]
		
		this.configuration={}
		this.statesToEnter=null
		this.invoked={}
		this.toInvoke=new Set()
		this.lastEvent=undefined
		
		this.sendNoMore=false
		
		this.delays={}
		this.timeouts=[]
		this.intervals=[]
		document.body.removeChild(this._iframe_)
		delete this._iframe_
		delete this.datamodel
		this.initIframe()
		
		this.running=false
		this.stable=false
		this.paused=false
		this.readyState=SCxml.LOADING
	
		setTimeout(function(sc){ sc.interpret(false) }, 0, this)
	},

	toString: function(){ return "SCxml("+this.name+")" },
	constructor: SCxml,
	
	// tell parent that we're ready and resume its mainEventLoop
	// if all other invoked sessions are also ready
	invokedReady: function()
	{
		if(!this.parent) return;
		this.parent.invoked[this.iid]=this
		if(this.iid in this.parent.toInvoke.items 
		&& !this.parent.toInvoke.remove(this.iid))
			this.parent.mainEventLoop2()
	},

	// XHR callbacks
	xhrResponse: function(xhr){ this.interpret(xhr.req.responseXML) },
	xhrFailed: function(xhr)
	{
		this.invokedReady()
		// the Webkit generates a perfectly good error message
		// when an XHR fails: no need to throw another on top
	},
	
	validate: function ()
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
			if(hasAttribute("name")) this.name=getAttribute("name")
		}
		
		with(this.dom)
		{
			var states=querySelectorAll("state, final, parallel, history")
			for(var i=0, state; state=states[i]; i++)
			// generate an ID for states that don't have one
				if(!state.hasAttribute('id'))
					state.setAttribute('id', this.uniqId())
			
			var invs=querySelectorAll("invoke")
			for(var i=0, inv; inv=invs[i]; i++)
			// generate an invokeID for invokes that don't have one
				if(!inv.hasAttribute('id')) inv.setAttribute('id',
					this.invokeId(inv.parentNode.getAttribute('id')))
			
			getElementById=function(id)
			{ return querySelector("state[id='"+id+"'], final[id='"+id+"'], history[id='"+id+"'], parallel[id='"+id+"']") }
		}
	},
	
	inInvoke: function (element)
	{
		for(var c=element.parentElement; c!=this.dom.documentElement; c=c.parentElement)
			if(c.tagName=="content") return true
		return false
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
	invokeId: function (stateId)
	{
		var id
		do{
			id=stateId+".inv"+Math.floor(Math.random()*1000000)
		}while(this.dom.querySelector("invoke[id='"+id+"']"))
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
		if(dom===false) dom=this.dom
		else{
			this.dom=dom
			try{this.validate()} catch(err){
				this.invokedReady()
				throw err
			}
			this.html.dispatchEvent(new Event("validated"))
		}

		// interpret top-level <datamodel> if present
		var d=dom.querySelector("scxml > datamodel")
		if(d) try{this.execute(d)} catch(err){}

		// update any declared variable with invocation shared data
		if(this.sharedData){
			for(var i in this.sharedData) if(this.sharedData.hasOwnProperty(i))
			{
				if(i in this.datamodel._jsscxml_predefined_)
					this.datamodel._jsscxml_predefined_[i]=this.sharedData[i]
				else if(i in this.datamodel)
					this.datamodel[i]=this.sharedData[i]
				else delete this.sharedData[i] // un-share undeclared data
			}
		}

		// interpret top-level <script>s if present
		d=dom.querySelectorAll("scxml > script")
		for(i=0; i<d.length; i++) if(!this.inInvoke(d[i]))
			try{this.wrapScript(d[i].textContent,d[i])} catch(err){}


		// interpret other <datamodel>s, but do not assign if binding="late"
		d=dom.querySelectorAll("scxml > * datamodel")
		for(i=0; i<d.length; i++) if(!this.inInvoke(d[i]))
		{
			if(this.lateBinding)
				try{d[i].unbound=true; this.declare(d[i])} catch(err){}
			else
				try{this.execute(d[i])} catch(err){}
		}
		
		this.running=true
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
		if(!s){
			this.invokedReady()
			throw this.name + " has no suitable initial state."
		}
		if(s instanceof Array) this.addStatesToEnter( s )
		else this.addStatesToEnter( [s] )
		
		this.readyState=SCxml.RUNNING
		this.html.dispatchEvent(new CustomEvent("enter", {detail:{list:
			this.statesToEnter.inEntryOrder()
			.filter(this.enterState,this).map(getId)} }))
		// this handles the case where an SC is initially final
		if(this.stable) this.terminate()
		// but normally we should go to the mainEventLoop
		else this.mainEventLoop()
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

		else if(state=this.dom.querySelector("[id="+getId(parent)+"] > initial"))
		{
			var trans=state.firstElementChild
			while(trans && trans.tagName!="transition")
				trans=trans.nextElementSibling
			if(!trans){
				this.invokedReady()
				throw this.name+": <initial> requires a <transition>."
			}
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
	
	addStatesToEnter: function(states, lcca)
	{
	for(var i=0, state; state=states[i]; i++)
	{
		state.CA=false
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
				if(!trans){
					this.invokedReady()
					throw this.name+": <history> requires a default <transition>."
				}
				// transition content must be run after parent's onentry
				// but before entering any children
				state.parentNode.executeAfterEntry=trans
				h=trans.getAttribute("target").split(/\s+/)
					.map(this.getById,this)
			}
			this.addStatesToEnter(h, lcca)
		}
		else this.statesToEnter=this.walkToEnter(state, this.statesToEnter, lcca)
	}
	},
	
	walkToEnter: function(state, tree, lcca)
	{
		var path=[]
		
		var id=getId(state)

		// find the maximal simple path that includes the state
		// and add/propagate the CA (Common Ancestor) property
		path.push(state)
		var down=state, up=state
		while(down = this.firstState(down)){
			path.push(down)
			down.CA=false
		}
		while((up = up.parentNode).tagName=="state" && up!=lcca){
			path.unshift(up)
			up.CA=state.CA
		}
		if(up.tagName=="state"){ do{
				path.unshift(up)
				up.CA=true
			} while((up = up.parentNode).tagName=="state")
		// also mark the parallel parent CA
			up.CA=true
		}
		else up.CA=(up==lcca)
		
		var ct=new CompiledTree(new CompiledPath(path))
		
		if(!ct.root.atomic)
		{
			var c=ct.root.end.firstElementChild
			while(c){ if(c.tagName in SCxml.STATE_ELEMENTS)
				{
					if(tree && tree.root.path[0]==c)
						ct.appendChild(tree)
					else if(!state.CA)
						this.walkToEnter(c,ct, lcca)
					else{
						for(var i=0, c2; c2=tree.children[i]; i++)
							if(c2.root.path[0]==c) break
						if(!c2) this.walkToEnter(c,ct, lcca)
					}
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
			ct=this.walkToEnter(ct.root.parent, ct, lcca)
		
		return ct
	},
	
	// add to the configuration, run the onentry stuff
	enterState: function(state)
	{
		var id=getId(state)
		if(id in this.configuration){ delete state.executeAfterEntry; return }
		this.configuration[id]=state
		state.setAttribute("active",true)
		
		var dm
		if(this.lateBinding
		&& (dm=this.dom.querySelector("[id="+id+"] > datamodel"))
		&& ('unbound' in dm)){
			delete dm.unbound
			try{this.execute(dm)} catch(err){}
		}

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
		if(state.tagName=="final"){
			var c=this.dom.querySelector("[id="+id+"] > donedata")
			if(c) try{this.donedata=this.readParams(c, {}, true)}
				catch(err){ this.donedata=null }
			return this.finalState(state.parentNode)
		}
		return true
	},

	finalState: function(state)
	{
		if(state.tagName=="scxml")
		{
			this.running=false
			this.stable=true
			this.readyState=SCxml.FINISHED
			this.html.dispatchEvent(new Event("finished"))
			return true
		}
		
		if(state.tagName=="parallel")
			for(var c=state.firstElementChild; c; c=c.nextElementSibling)
				if(c.tagName in SCxml.STATE_ELEMENTS && !c.fin) return;
		
		state.fin=true
		var id=getId(state)
		var doneEv=new SCxml.Event("done.state."+id)
		doneEv.data=this.donedata
		delete this.donedata
		this.html.dispatchEvent(new CustomEvent("queue", {detail:doneEv}))
		this.internalQueue.push(doneEv)
		if(state.parentNode.tagName=="parallel")
			this.finalState(state.parentNode)
		return true
	},

	// compute the LCCA unless it was already and the transition isn't dynamic
	findLCCA: function(trans)
	{
		if(trans.lcca && !trans.hasAttribute("targetexpr")) return;
		var source=trans.parentNode, targets=trans.targets
		trans.internal=false
		if(targets==null) return trans.lcca=null // targetless
		trans.lcca=source
		var ids=targets.map(function (e){
				if(e.tagName=="history") e=e.parentNode
				var id=getId(e)
				return "state[id="+id+"], final[id="+id+"], history[id="+id+"], parallel[id="+id+"]"})
			.join(", ")
		// determine transition type
		// get Least Common Compound Ancestor
		if(source.querySelectorAll(ids).length==targets.length
		&& source.tagName!="parallel")
			if(trans.internal=(trans.getAttribute("type")=="internal"))
				return;
		else while((trans.lcca=trans.lcca.parentNode)
			.querySelectorAll(ids).length<targets.length );
		if(!trans.internal && trans.lcca==source)
			trans.lcca=trans.lcca.parentNode
		for(var i=0, e; e=targets[i]; i++) if(e==trans.lcca)
			trans.lcca=trans.lcca.parentNode
		while(trans.lcca.tagName=="parallel") trans.lcca=trans.lcca.parentNode
	},
	
	saveHistory: function(state)
	{
		var id=getId(state)
		if(!(id in this.configuration)) return;
		
		var histories=this.dom.querySelectorAll("[id="+id+"] > history")
		for(var i=0, h; h=histories[i]; i++)
		h.record=this.activeChildren(state, h.getAttribute("type")=="deep")
	},
	
	// remove a state from the configuration,
	// and don't forget to run the onexit blocks before
	exitState: function(state)
	{
		var id=getId(state)
		if(!(id in this.configuration)) return;
		
		state.removeAttribute("willExit")
		
		var onexit=this.dom.querySelectorAll("[id="+id+"] > onexit")
		for(var i=0; i<onexit.length; i++)
			try{this.execute(onexit[i])}
			catch(err){}
		
		var invoked=this.dom.querySelectorAll("[id="+id+"] > invoke")
		for(i=0; i<invoked.length; i++)
			this.cancelInvoke(getId(invoked[i]))

		delete this.configuration[id]
		state.removeAttribute("active")
		return true
	},

	// wrapper for eval, to handle expr and similar attributes
	// that need to be evaluated as ECMAScript
	expr: function(s,el)
	{
		// TODO: check that the expr doesn't do horrible stuff
		return this.datamodel.expr(s,el)
	},
	
	log: function(s){console.log(s)},	// easy to override later
	
	// displays errors nicely in the console,
	// including the SCXML element that started it
	// (we can't determine the SCXML line number)
	error: function(name, src, err, doNotShow){
		var e=new SCxml.Error("error."+name, src, err)
		this.html.dispatchEvent(new CustomEvent("queue", {detail:e}))
		this.internalQueue.push(e)
		if(!doNotShow) console.error(err+"\nin SCXML "+this.name+" :", src)
		throw(err)
	},
	
	// returns a list of all enabled transitions for an event (or eventless)
	selectTransitions: function(event)
	{
		var sc=this
		function test(s)
		{
			for(var t=s.firstElementChild; t; t=t.nextElementSibling)
			{
				if(t.nodeType!=1 || t.tagName!="transition"
				|| (event? !(t.hasAttribute("event") && event.match(t))
					: t.hasAttribute("event"))) continue

				var cond=false
				try{ cond=!t.hasAttribute("cond")
					|| sc.expr(t.getAttribute("cond"),t)
				}catch(err) {}
				if(!cond) continue
				
				// compute targets each time if 'targetexpr'
				if(t.hasAttribute("targetexpr"))
				{ try{
					var targets=String(sc.expr(t.getAttribute("targetexpr"),t))
					if(!targets) t.targets=null
					else t.targets=targets.split(/\s+/).map(sc.getById,sc)
					} catch(err){ t.targets=null }
				}
				// or just once then reuse it if it's plain old 'target'
				else if(!t.targets){
					if(t.hasAttribute("target"))
						t.targets=t.getAttribute("target")
						.split(/\s+/).map(sc.getById,sc)
					else t.targets=null
				}
				return t
			}
			return false
		}
		
		return this.statesToEnter.select(test).enabled
	},
	
	mainEventLoop: function()
	{
		while(this.running && !this.stable){
			this.macrostep()
			if(!this.running) return this.terminate()
			
			if(this.invokeAll()) return; // because invocation is asynchronous
			
			this.stable=true
			this.extEventLoop()
			if(!this.running) return this.terminate()
		}
		this.invokedReady()
	},
	
	// this is called if there were states to invoke in the main loop
	mainEventLoop2: function()
	{
		if(this.internalQueue.length) return this.mainEventLoop()
		// macrostep completed and invocation errors handled
		
		this.stable=true
		this.extEventLoop()
		if(!this.running) return this.terminate()
		this.mainEventLoop()
	},
	
	macrostep: function()
	{
		while(this.running){
			// first try eventless transition
			var trans=this.selectTransitions(null)
			if(!trans.length){
				// if none is enabled, consume internal events
				var event
				while(event=this.internalQueue.shift())
				{
					this.lastEvent=event
					this.html.dispatchEvent(new CustomEvent("consume", {detail:"internal"}))
					trans=this.selectTransitions(event)
					if(trans.length) break
				}
			}
			if(trans.length) this.takeTransitions(trans)
			else break
		}
	},

	extEventLoop: function()
	{
		this.stable=false
		// consume external events
		var event, trans
		while(event=this.externalQueue.shift())
		{
			this.lastEvent=event
			if(event.invokeid && (event.invokeid in this.invoked)){
				var f=this.dom.querySelector("[id='"+event.invokeid+"'] > finalize")
				if(f){
					if(f.firstElementChild) this.execute(f)
					else this.emptyFinalize(event)
				}
			}
			this.html.dispatchEvent(new CustomEvent("consume", {detail:"external"}))
			
			// autoforward event to invoked sessions
			for(var i in this.invoked) if(this.invoked[i].af)
				this.invoked[i].fireEvent(event)
			
			trans=this.selectTransitions(event)
			if(trans.length)
				return this.takeTransitions(trans)
		}
		
		// if we reach here, no transition could be used
		this.stable=true
		this.html.dispatchEvent(new Event("waiting"))
	},
	
	// try to follow transitions, after exiting the source states
	takeTransitions: function(trans)
	{
		// first mark all the states that must be exited
		for(var i=0; t=trans[i]; i++)
		{
			// preemtion, part II
			if(t.parentElement.getAttribute("willExit") && t.targets){
				trans.splice(i--,1)
				continue
			}
			this.findLCCA(t)
			if(!t.targets) continue
			
			var s=this.dom.createNodeIterator(t.lcca,
				NodeFilter.SHOW_ELEMENT, SCxml.activeStateFilter)
			var v=s.nextNode()
			if(v && v!=t.lcca) v.setAttribute("willExit",true)
			while(v=s.nextNode()) v.setAttribute("willExit",true)
			s.detach()
		}
		// now exit in reverse document order
		var toExit=this.dom.querySelectorAll("[willExit]")
		var rev=[]
		if(toExit.length)
		{
			for(i=toExit.length-1; i>=0; i--) rev.push(toExit[i])
			rev.forEach(this.saveHistory, this)
			this.html.dispatchEvent(new CustomEvent("exit", {detail:
				{list: rev.filter(this.exitState, this).map(getId)} }))
		}
		
		// now, between exit and entry, run the executable content if present
		for(i=0; t=trans[i]; i++)
		{
			try{ this.execute(t) }
			catch(err){}
		}

		var currentConf=this.statesToEnter
		this.statesToEnter=null
		// then enter all the states to enter
		for(i=0; t=trans[i]; i++) if(t.targets)
			this.addStatesToEnter(t.targets, t.lcca)
		if(this.statesToEnter)
			this.html.dispatchEvent(new CustomEvent("enter", {detail:{list:
				this.statesToEnter.inEntryOrder()
				.filter(this.enterState,this).map(getId)} }))
		else this.statesToEnter=currentConf
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

	// handles external events
	onEvent:function(event)
	{
		if(!this.running)
		{
			console.warn(this.name+" has terminated and cannot process more events")
			return
		}
		if(event instanceof Event)
			event=SCxml.ExternalEvent.fromDOMEvent(event)
		else if((typeof event) == "string")
			event=new SCxml.ExternalEvent(event, null, undefined, null, arguments[1])
		
		this.html.dispatchEvent(new CustomEvent("queue", {detail:event}))
		this.externalQueue.push(event)
		if(this.stable && !this.paused){
			this.extEventLoop()
			if(!this.running) return this.terminate()
			if(!this.stable) this.mainEventLoop()
		}
	}
}

SCxml.prototype.fireEvent=SCxml.prototype.onEvent

SCxml.NO_PAUSE=0
SCxml.EXT_EVENTS=1
SCxml.ALL_EVENTS=2

SCxml.LOADING=0
SCxml.READY=1
SCxml.RUNNING=2
SCxml.FINISHED=3

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
