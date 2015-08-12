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
delays.js			pauseable wrapper for delays, timeouts and intervals
SCxmlProcessors.js	implements Event IO Processors
SCxmlDatamodel.js	the datamodel wrapper iframe
SCxmlEvent.js		authors may want to read that one
SCxmlExecute.js		implements executable content
SCxmlInvoke.js		contains most of the <invoke> implementation
*SCxmlMutation.js	handles runtime SCXML DOM mutations
*SCxmlFetch.js		makes XMLHttpRequests available to SCXML documents
*SCxmlConnect.js	defines connection-like invoke and the event-stream type
*SCxmlSpeak.js		a simple <speak> element around the SpeechSynthesis API
**SCxmlDebug.js		allows pause/resume and graphical debugging and editing

Files marked with * are optional, you may build a smaller custom package by removing some of them from the command line in uglify.sh

SCxmlDebug is optional and not bundled by default with the "ugly" distribution;
It is recommended that you include the "pretty" files instead when debugging,
so that you may see something readable if you use a JavaScript debugger.

*/

// source can be a URI, an SCXML string, a parsed document or a File
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
	this.transitionsToTake=null
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
	
	if(SCxml.mutations) this.initObservers()

	this.name="session "+this.sid

	if(source instanceof Document)
		setTimeout(function(sc, dom){ sc.interpret(dom) }, 0, this, source)
	else if(('File' in window) && (source instanceof File))
	{
		this.name=source.name
		var f=new FileReader()
		f.sc=this
		f.onload=SCxml.fileLoaded
		f.onerror=SCxml.fileFailed
		f.readAsText(source, "utf-8")
	}
	else if(/^\s*</.test(source))
	{
		var d=new DOMParser().parseFromString(source, "application/xml")
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

// FileReader callbacks
SCxml.fileLoaded=function(e)
{
	var sc=this.sc
	delete this.sc
	var d=new DOMParser().parseFromString(this.result, "application/xml")
	sc.interpret(d)
}
SCxml.fileFailed=function(e){ delete this.sc }

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
		delete this.JSSCID

		document.body.removeChild(this._iframe_)
		delete this._iframe_

		SCxml.sessions[this.sid]=null
		
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
		
		var histories=this.dom.querySelectorAll("history")
		for(var i=0, h; h=histories[i]; i++) delete h.record
		
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
	
	// tell parent that we're ready
	invokedReady: function()
	{
		if(!this.parent) return;
		this.parent.invoked[this.iid]=this
		if(this.iid in this.parent.toInvoke.items)
			this.parent.toInvoke.remove(this.iid)
	},

	// XHR callbacks
	xhrResponse: function(xhr){ this.interpret(xhr.req.responseXML) },
	xhrFailed: function(xhr)
	{
		this.invokedReady()
		// the Webkit generates a perfectly good error message
		// when an XHR fails: no need to throw another on top
	},
	
	// checks all targets for an element;
	checkTargets: function(target, element)
	{
		element.targets=new Set()
		for(var i=0, t, r, ts=target.split(/\s+/); t=ts[i]; i++){
			if(r=this.dom.getElementById(t)){
			// target exists; add to targets set and reverse target list
				element.targets.add(r._JSSCID)
				if(t in this.targets) this.targets[t].add(element._JSSCID)
				else this.targets[t]=new Set(element._JSSCID)
			}
			else{
			// target does not exists; add to reverse missing target list
				if(t in this.missingTargets)
					this.missingTargets[t].add(element._JSSCID)
				else this.missingTargets[t]=new Set(element._JSSCID)
			}
		}
		if(!element.targets.length) element.targets=""
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
		
		this.missingTargets={} // {missing target ID : [source JSSCIDs]}
		this.targets={} // {existing state ID : [source JSSCIDs]}
		this.JSSCID={} // {JSSCID : DOM element}
		this.lastJSSCID=1
		
		with(this.dom)
		{
			// first give everything an internal JSSCID
			var s=createNodeIterator(documentElement,
				NodeFilter.SHOW_ELEMENT, SCxml.guiFilter)
			while(v=s.nextNode())
				this.JSSCID[v._JSSCID=this.lastJSSCID++]=v
			s.detach()
			
			getElementById=function(id)
			{
				var r=querySelectorAll("state[id='"+id+"'], final[id='"+id+"'], history[id='"+id+"'], parallel[id='"+id+"']")
				for(var i=0, s; s=r[i]; i++){
					for(var c=s.parentElement; c && c.tagName!="content";
						c=c.parentElement);
					if(!c) return s
				}
				return null
			}

			if(documentElement.hasAttribute('initial'))
				this.checkTargets(documentElement.getAttribute('initial'),
					documentElement)
			
			var states=querySelectorAll("state, final, parallel, history")
			for(var i=0, state; state=states[i]; i++){
				// generate an ID for states that don't have one
				if(!state.hasAttribute('id'))
					state.setAttribute('id', this.uniqId())

				// check that initial target exists
				if(!this.inInvoke(state)){
					state.executeAfterEntry=[]
					if(state.tagName=="parallel")
						state.initial=[]
					else if(state.hasAttribute('initial'))
						this.checkTargets(state.getAttribute('initial'), state)
				
					if(this.obs && state.localName in this.obs)
						this.obs[state.localName]
						.observe(state, SCxml.observerOptions[state.localName])
				}
			}
			
			var invs=querySelectorAll("invoke")
			for(var i=0, inv; inv=invs[i]; i++)
			// generate an invokeID for invokes that don't have one
				if(!inv.hasAttribute('id')) inv.setAttribute('id',
					this.invokeId(inv.parentNode.getAttribute('id')))
			
			var trans=querySelectorAll("transition")
			for(var i=0, tr; tr=trans[i]; i++)
			// check that targets exist
				if(!this.inInvoke(tr)){
					if(tr.hasAttribute('target'))
						this.checkTargets(tr.getAttribute('target'), tr)
					else tr.targets=""
					
					if(this.obs) this.obs.transition
						.observe(tr, SCxml.observerOptions.transition)
				}
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
		this.invokedReady()
		if(this.interpretASAP) this.start()
	},
	
	start: function()
	{
		if(this.readyState<SCxml.READY) throw this.name+" is not ready yet."
		if(this.readyState>SCxml.READY) throw this.name+" has already started."
		
		var s=this.firstState(this.dom.documentElement)
		// and... enter !
		if(!s)
			throw this.name + " has no suitable initial state."
		this.addStatesToEnter( s )
		
		this.readyState=SCxml.RUNNING
		this.html.dispatchEvent(new CustomEvent("enter", {detail:{list:
			this.statesToEnter.inEntryOrder()
			.filter(this.enterState,this).map(getId)} }))
		// this handles the case where an SC is initially final
		if(this.stable) this.terminate()
		// but normally we should go to the mainEventLoop
		else this.mainEventLoop()
	},
	
	resolve: function(a)
	{
		if(a instanceof Set){
			var b=[]
			for(var i in a.items) b.push(this.JSSCID[i])
			return b
		}
		else return this.JSSCID[a]
	},
	
	// find the initial state in the document or in a <state>;
	// returns null or undefined if the state is atomic or parallel
	firstState: function(parent)
	{
		if(parent.tagName!="state" && parent.tagName!="scxml")
			return null
		
		if(parent.targets)
			return this.rememberHistory(this.resolve(parent.targets))
		
		if(parent.tagName=="state"
		&& (state=SCxml.childOfType(parent, "initial")))
		{
			var trans=state.firstElementChild
			while(trans && trans.tagName!="transition")
				trans=trans.nextElementSibling
			if(!trans)
				throw this.name+": <initial> requires a <transition>."
			parent.executeAfterEntry=[trans]
			if(trans.hasAttribute("targetexpr")) this.checkTargets(
				this.expr(trans.getAttribute("targetexpr"), trans), trans)
			return this.rememberHistory(this.resolve(trans.targets))
		}
		
		var state=parent.firstElementChild

		while(state && !(state.tagName in SCxml.STATE_ELEMENTS))
			state=state.nextElementSibling
		return state?[state]:null
	},
	
	rememberHistory: function(states)
	{
		var remembered=[]
		for(var i=0, state; state=states[i]; i++)
		{
			if(state.tagName=="history"){
				if("record" in state)
					remembered=remembered.concat(state.record)
				else // use the transition by default
				{
					var trans=state.firstElementChild
					while(trans && trans.tagName!="transition")
						trans=trans.nextElementSibling
					if(!trans) throw this.name+": <history> requires a default <transition>."
					// transition content must be run after parent's onentry
					// but before entering any children
					state.parentNode.executeAfterEntry.push(trans)
					remembered=remembered.concat(
						this.rememberHistory(this.resolve(trans.targets)))
				}
			}
			else remembered.push(state)
		}
		return remembered
	},
	
	addStatesToEnter: function(states, lcca)
	{
		states=this.rememberHistory(states)
		for(var i=0, state; state=states[i]; i++)
		{
			state.CA=false
			this.statesToEnter=this.walkToEnter(state, this.statesToEnter, lcca)
		}
	},

	// given a list of states, remove any state that has a child in the list
	// (also removes duplicates)
	reduceConfiguration: function(states)
	{
		var reduced=[]
		there:for(var i=0, state; state=states[i]; i++){
			for(var j=0, child; child=states[j]; j++)
				if(state!=child && state.contains(child)) continue there
			for(var j=0, other; other=reduced[j]; j++)
				if(state==other) continue there
			reduced.push(state)
		}
		return reduced
	},
	
	// this is used when a state has initial substates that are not a
	// direct child; if there is more than one initial, there MUST be
	// a common parallel state between them and the original state,
	// otherwise we'd have an illegal configuration.
	walkUpFromCP: function(initials, path)
	{
		var top=path[path.length-1]
		var CP=null
		var initial=initials[0]
		if(initial==top) return top
		var up=initial
		while((up=up.parentNode) && up != top)
			if(up.tagName=="parallel") CP=up
		if(CP && CP != initial) CP.initial=initials
		var rpath=[up=CP||initial]
		while((up=up.parentNode) && up != top){
			rpath.push(up)
			up.CA=false
		}
		return path.concat(rpath.reverse())
	},

	walkToEnter: function(state, tree, lcca)
	{
		var path=[state]
		
		var id=getId(state)

		if(state.initial && state.initial.length) state.initial=[]
		
		// this means we have to aim for an ancestor's deep initial target
		// before we use the normal algorithm
		if(state.parentNode.initial && state.parentNode.initial.length){
			var initials=state.parentNode.initial.filter(state.contains, state)
			if(initials){
				path=this.walkUpFromCP(initials, path)
			}
		}

		// find the maximal simple path that includes the state
		// and add/propagate the CA (Common Ancestor) property
		var down=path[path.length-1], up=state
		while(down = this.firstState(down)){
			if(down.length>1 || down[0].parentNode!=path[path.length-1]){
				path=this.walkUpFromCP(this.reduceConfiguration(down), path)
				down=path[path.length-1]
				continue
			}
			down = down[0]
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
		if(id in this.configuration){ state.executeAfterEntry=[]; return }
		this.configuration[id]=state
		state.setAttribute("active",true)
		
		var dm
		if(this.lateBinding
		&& (dm=SCxml.childOfType(state, "datamodel"))
		&& ('unbound' in dm)){
			delete dm.unbound
			try{this.execute(dm)} catch(err){}
		}

		var onentry=SCxml.childrenOfType(state, "onentry")
		for(var i=0, ex; ex=onentry[i] || state.executeAfterEntry.shift(); i++)
			try{this.execute(ex)}
			catch(err){}
		
		state.fin=false
		if(state.tagName=="final"){
			var c=SCxml.childOfType(state, "donedata")
			if(c) try{state.parentNode.donedata=this.readParams(c, {}, true)}
				catch(err){ state.parentNode.donedata=null }
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
			this.html.dispatchEvent(new CustomEvent("finished", {detail:state.donetata}))
			return true
		}
		
		if(state.tagName=="parallel")
			for(var c=state.firstElementChild; c; c=c.nextElementSibling)
				if(c.tagName in SCxml.STATE_ELEMENTS && !c.fin) return;
		state.fin=true
		
		var id=getId(state)
		var doneEv=new SCxml.Event("done.state."+id)
		
		doneEv.data=(state.tagName=="parallel")||state.donedata
		delete state.donedata
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
		var source=trans.parentNode, targets=this.resolve(trans.targets)
		trans.internal=false
		if(targets==null) return trans.lcca=null // targetless
		trans.lcca=source
		// determine transition type
		// get Least Common Compound Ancestor
		if(targets.every(source.contains, source) && targets.indexOf(source)<0){
			if(source.tagName!="parallel" 
			&& (trans.internal=(trans.getAttribute("type")=="internal")))
				return
		}else do{trans.lcca=trans.lcca.parentNode}
			while(!targets.every(trans.lcca.contains, trans.lcca))
		if(targets.indexOf(trans.lcca)>-1)
			trans.lcca=trans.lcca.parentNode
		if(!trans.internal && trans.lcca==source)
			trans.lcca=trans.lcca.parentNode
		while(trans.lcca.tagName=="parallel") trans.lcca=trans.lcca.parentNode
	},
	
	saveHistory: function(state)
	{
		var id=getId(state)
		if(!(id in this.configuration)) return;
		
		var histories=SCxml.childrenOfType(state, "history")
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
		
		var onexit=SCxml.childrenOfType(state, "onexit")
		for(var i=0; i<onexit.length; i++)
			try{this.execute(onexit[i])}
			catch(err){}
		
		var invoked=SCxml.childrenOfType(state, "invoke")
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
		if(/^function/.test(s)) s="_x.__left__="+s
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
					else this.checkTargets(targets, t)
					} catch(err){ t.targets=null }
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
			
			if(this.invokeAll() && this.internalQueue.length) continue
			
			this.stable=true
			this.extEventLoop()
			if(!this.running) return this.terminate()
		}
	},
	
	normalizeEmptyData: function(event)
	{
		if(!event) return event
		if(event.data===null) event.data=undefined
		if('object' != typeof event.data) return event
		var def=false
		for(var i in event.data) if(event.data.hasOwnProperty(i)){
			def=true
			break
		}
		if(!def) event.data=undefined
		return event
	},
	
	macrostep: function()
	{
		while(this.running){
			// first try eventless transition
			var trans=this.selectTransitions(null)
			if(!trans.length){
				// if none is enabled, consume internal events
				var event
				while(event=this.normalizeEmptyData(this.internalQueue.shift()))
				{
					this.lastEvent=event
					this.html.dispatchEvent(new CustomEvent("consume", {detail:"internal"}))
					trans=this.selectTransitions(event)
					if(trans.length) break
				}
			}
			if(trans.length) this.preTransitions(trans)
			else break
		}
	},

	extEventLoop: function()
	{
		this.stable=false
		// consume external events
		var event, trans
		while(event=this.normalizeEmptyData(this.externalQueue.shift()))
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
				return this.preTransitions(trans)
		}
		
		// if we reach here, no transition could be used
		this.stable=true
		this.html.dispatchEvent(new Event("waiting"))
	},
	
	// mark states to be exited and preempt transitions
	preTransitions: function(trans)
	{
		for(var i=0, t; t=trans[i]; i++)
		{
			// preemtion, part II
			if(t.parentElement.getAttribute("willExit") && t.targets.length){
				trans.splice(i--,1)
				continue
			}
			this.findLCCA(t)
			if(!t.targets.length) continue
			
			var s=this.dom.createNodeIterator(t.lcca,
				NodeFilter.SHOW_ELEMENT, SCxml.activeStateFilter)
			var v=s.nextNode()
			if(v && v!=t.lcca) v.setAttribute("willExit",true)
			while(v=s.nextNode()) v.setAttribute("willExit",true)
			s.detach()
		}
		this.transitionsToTake=trans
		this.html.dispatchEvent(new Event("step"))
		this.takeTransitions()
	},
	
	// try to follow transitions, after exiting the source states
	takeTransitions: function()
	{
		// exit in reverse document order
		var toExit=this.dom.querySelectorAll("[willExit]")
		var rev=[], t, i
		if(toExit.length)
		{
			for(i=toExit.length-1; i>=0; i--) rev.push(toExit[i])
			rev.forEach(this.saveHistory, this)
			this.html.dispatchEvent(new CustomEvent("exit", {detail:
				{list: rev.filter(this.exitState, this).map(getId)} }))
		}
		
		// now, between exit and entry, run the executable content if present
		for(i=0; t=this.transitionsToTake[i]; i++)
		{
			try{ this.execute(t) }
			catch(err){}
		}

		var currentConf=this.statesToEnter
		this.statesToEnter=null
		// then enter all the states to enter
		for(i=0; t=this.transitionsToTake[i]; i++) if(t.targets.length)
			this.addStatesToEnter(this.resolve(t.targets), t.lcca)
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
SCxml.IN_GUI={
	scxml: {parents:[]},
	state: {parents:['state', 'parallel', 'scxml'], idType:'state'},
	parallel: {parents:['state', 'parallel', 'scxml'], idType:'state'},
	'final': {parents:['state', 'parallel', 'scxml'], idType:'state'},
	history: {parents:['state', 'parallel'], idType:'state'},
	
	initial: {parents:['state', 'parallel']},
	transition: {parents:['state', 'parallel', 'initial', 'history']},

	invoke: {parents:['state', 'parallel'], idType:'invoke'},
	finalize: {parents:['invoke']},
	
	onentry: {parents:['state', 'parallel', 'final']},
	onexit: {parents:['state', 'parallel', 'final']},
	script: {parents:['scxml']},
	
	datamodel: {parents:['state', 'parallel', 'scxml', 'final']},
	donedata: {parents:['final']}
}

SCxml.stateFilter={acceptNode: function(node){ return 2-(node.tagName in SCxml.STATE_ELEMENTS) }}

SCxml.guiFilter={acceptNode: function(node){ return 2-(node.tagName in SCxml.IN_GUI) }}

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

SCxml.subStates=function (s){
	for(var ss=[], c=s.firstElementChild; c; c=c.nextElementSibling)
		if(c.localName in SCxml.STATE_ELEMENTS) ss.push(c)
	return ss
}
SCxml.childOfType=function (s, name){
	for(var c=s.firstElementChild; c; c=c.nextElementSibling)
		if(c.localName == name) return c
	return null
}
SCxml.childrenOfType=function (s, name){
	for(var ct=[], c=s.firstElementChild; c; c=c.nextElementSibling)
		if(c.localName == name) ct.push(c)
	return ct
}

