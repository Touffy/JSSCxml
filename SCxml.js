/*
SCxml is the main object of this library.
It must be instantiated for each SCXML document.


JSSCxml provides a function (SCxml.parseSCXMLTags) for automatically
creating SCxml instances from the src attribute of every <scxml> element
in the main Webpage.
*/

// for now, source can only be a URI
function SCxml(source)
{
	this.dom=null
	
	this.internalQueue=[]
	this.externalQueue=[]
	
	this.configuration={}
	this.sid=++SCxml.sessionCount
	this.datamodel=new SCxml.Datamodel(this)
	SCxml.sessions[this.sid]=this
	
	this.running=false
	this.stable=false

	if(source instanceof Element)
	{
		// not really implemented
		this.interpret(source)
	}
	else
	{
		console.log("Fetching "+source+"…")
		new XHR(source, this, this.xhrResponse, null, this.xhrFailed)
	}
}

SCxml.sessions=[]
SCxml.sessionCount=0

SCxml.EventProcessors={
	SCXML:{name:"http://www.w3.org/TR/scxml/#SCXMLEventProcessor"},
	basichttp:{name:"http://www.w3.org/TR/scxml/#BasicHTTPEventProcessor"},
	DOM:{name:"http://www.w3.org/TR/scxml/#DOMEventProcessor"}
}
/*
This is necessary for the In method to work flawlessly.
By using a closure, I let In() access the configuration
without adding the name 'configuration' to the datamodel.
*/
SCxml.Datamodel=function SCxmlDatamodel(sc)
{
	this.In=function In(state){ return state in sc.configuration }
	this._sessionid=sc.sid
}
SCxml.Datamodel.prototype={
	_event:undefined,
	_name:"",
	_ioprocessors:SCxml.EventProcessors,
	_x:{},
	
	// these are here to prevent direct HTML DOM access from SCXML scripts
	
	document:undefined,
	window:undefined,
	history:undefined,
	navigator:undefined
}

/*
Instantiates an SCxml() for each <scxml> in the HTML document,
and references it in an "interpreter" property of the
corresponding <scxml> element
*/
SCxml.parseSCXMLTags=function ()
{
	var tags=document.getElementsByTagName("scxml")
	for(var i=0; i<tags.length; i++)
		tags[i].interpreter=new SCxml(tags[i].getAttribute("src"))
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
	
	validate: function()
	{
		// TODO: much more validation
		with(this.dom.documentElement)
		{
			if(tagName!="scxml")
				throw this.dom.documentURI+" is not an SCXML document"
			if(namespaceURI!="http://www.w3.org/2005/07/scxml")
				throw this.dom.documentURI+" is not a valid SCXML document (missing or incorrect xmlns)"
			if(hasAttribute("datamodel")
			&& getAttribute("datamodel") != "ecmascript")
				throw "'"+getAttribute("datamodel")+"' datamodel in"
				+ this.dom.documentURI +" is not supported by JSSCxml"
			if(hasAttribute("binding")
			&& getAttribute("binding") != "early"
			&& getAttribute("binding") != "late")
				throw "binding='"+getAttribute("binding")+"' in"
				+ this.dom.documentURI +" is not valid"
			this.lateBinding=(getAttribute("binding")=="late")
			this.datamodel._name=getAttribute("name")
		}
		// use just the filename for messages, URI can be quite long
		this.name=this.dom.documentURI.match(/[^/]+\.(?:sc)?xml/)[0]
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
			try{this.expr(d[i].textContent,d[i])} catch(err){continue}


		// interpret other <datamodel>s, but do not assign if binding="late"
		d=dom.querySelectorAll("scxml > * datamodel")
		for(var i=0; i<d.length; i++)
		{
			if(lb)
				try{this.declare(d[i])} catch(err){throw err}
			else
				try{this.execute(d[i])} catch(err){throw err}
		}
		// now restore lateBinding
		this.lateBinding=lb
		
		this.running=true
		console.log("The interpreter for "+this.name+" is now ready.")
		
		var init=this.firstState(dom.documentElement)
		// and... enter !
		if(!init) throw this.name + " has no suitable initial state."
		this.enterState( init )
	},
	
	firstState: function(parent)
	{
		var id, state
		if(parent.hasAttribute("initial"))
		{
			state=this.dom.getElementById(id=parent.getAttribute("initial"))
			if(!state) throw "initial state with id='"
				+id+"' not found in "+this.name
			return state
		}

		if(state=this.dom.querySelector("#"+parent.getAttribute("id")
			+" > *[initial]"))
			return state
		
		state=parent.firstElementChild
		while(state && !(state.tagName in SCxml.STATE_ELEMENTS))
			state=state.nextElementSibling
		return state
	},
	
	// add an event and its ancestors to the configuration,
	// run the onentry stuff then start the event loop
	enterState: function (state,rec)
	{
		if(!(state.tagName in SCxml.STATE_ELEMENTS))
			throw state +" is not a state element."
		// spec says we MUST generate an id for states that have none
		if(!state.hasAttribute('id'))
			state.setAttribute('id', this.uniqId())

		var id=state.getAttribute('id')
		if(id in this.configuration) return
		this.configuration[id]=(state)
		
		// first add ancestors to the configuration
		if(state.parentNode.tagName != "scxml")
			this.enterState(state.parentNode,true)
				
		// now add this one
		var onentry=this.dom.querySelectorAll("#"+id+" > onentry")
		for(var i=0; i<onentry.length; i++)
			try{this.execute(onentry[i])}
			catch(err){continue}
		
		switch(state.tagName)
		{
		case "parallel":
			var c=state.firstElementChild
			while(c) if(c.tagName in SCxml.STATE_ELEMENTS)
			{
				this.enterState(c,true)
				c=c.nextElementSibling
			}
			break
		case "final":
			if(state.parentNode==this.dom.documentElement)
			{
				this.running=false
				this.stable=true
				console.log(this.name+" reached top-level final state: Terminated.")
				SCxml.sessions[this.sid]=null
				return
			}
			else
				this.internalQueue.push(new SCxml.Event("done.state."
				+state.parentNode.getAttribute("id")))
		default:
			var first
			if(first = this.firstState(state))
				this.enterState(first,true)
		}

		if(!rec) this.mainEventLoop()
	},
	// remove a state and its ancestors from the configuration,
	// and don't forget to run the onexit blocks
	exitState: function (state, common)
	{
		if(!(state.tagName in SCxml.STATE_ELEMENTS))
			throw state +" is not a state element."
		
		common=common||this.dom.documentElement
		if(state.parentNode!=common)
			this.exitState(state.parentNode)
		
		var id=state.getAttribute('id')		
		delete this.configuration[id]
		
		var onexit=this.dom.querySelectorAll("#"+id+" > onexit")
		for(var i=0; i<onexit.length; i++)
			try{this.execute(onexit[i])}
			catch(err){continue}
	},

	// wrapper for eval, to handle expr and similar attributes
	// that need to be evaluated as ECMAScript
	expr: function(s,el)
	{
		// TODO: check that the expr doesn't do horrible stuff
		
		try{ with(this.datamodel){ return eval(s) } }
		catch(e){
			this.internalQueue.push(new SCxml.Error("error.execution",el,e))
			throw e
		}
	},
	
	// just declares datamodel variables as undefined
	declare: function (element)
	{
		var c=element.firstElementChild
		if(element.tagName=="data")
		{
			var id=element.getAttribute("id")
			this.datamodel[id]=undefined
		}
		else while(c)
		{
			this.declare(c)
			c=c.nextElementSibling
		}
	},
	
	log: console.log,	// easy to override later
	
	// handles executable content
	execute: function (element)
	{
		var value=element.getAttribute("expr")
		var c=element.firstElementChild
		var loc, event
		switch(element.tagName)
		{
		case "raise":
			event=element.getAttribute("event")
				||this.expr(element.getAttribute("eventexpr"))
			this.internalQueue.push(new SCxml.InternalEvent(event, element))
			break
		case "send":
			var target=element.getAttribute("target")
				||this.expr(element.getAttribute("targetexpr"))
				||"#_scxml_"+this.sid
			event=element.getAttribute("event")
				||this.expr(element.getAttribute("eventexpr"))
			var id=element.getAttribute("id")||this.uniqId()
			if(loc=element.getAttribute("idlocation"))
				this.expr(loc+'="'+id+'"')
			var type=element.getAttribute("type")
				||this.expr(element.getAttribute("typeexpr"))
				||SCxml.EventProcessors.SCXML.name
			var delay=element.getAttribute("delay")
				||this.expr(element.getAttribute("delayexpr"))
				||0

			if(target=="#_internal")
			{
				this.internalQueue.push(new SCxml.InternalEvent(event, element))
				break
			}
			
			var data="" // not implemented yet
			var e=new SCxml.ExternalEvent(event, id, this.sid, "", "", data)
			if(delay) window.setTimeout(SCxml.send, delay, target, e)
			else SCxml.send(target, e)
			break
		case "log":
			this.log(element.getAttribute("label")+" = "
				+this.expr(value,element))
			break
		case "data":
			if(!this.lateBinding) break // do not reinitialize again
			var id=element.getAttribute("id")
			// create the variable first, so it's "declared"
			// even if the assignment part fails or doesn't occur
			this.datamodel[id]=undefined
			if(element.hasAttribute("expr"))
				this.expr(id+" = "+value, element)
			else if(value=element.getAttribute("src"))
			{
				// TODO: fetch the data
			}
			break
		case "assign":
			loc=element.getAttribute("location")
			if(!(loc in this.datamodel)){
				this.internalQueue.push(
						new SCxml.Error("error.execution",element))
				throw this.name+"'s datamodel doesn't have location "+loc
			}
			if(value) this.expr(loc+" = "+value, element)
			break
		case "if":
			var cond=this.expr(element.getAttribute("cond"))
			while(!cond && c)
			{
				if(c.tagName=="else") cond=true
				if(c.tagName=="elseif") cond=this.expr(c.getAttribute("cond"))
				c=c.nextElementSibling
			}
			while(c)
			{
				if(c.tagName=="else" || c.tagName=="elseif") break
				this.execute(c)
				c=c.nextElementSibling
			}
			break
		case "foreach":
			var a=this.expr(element.getAttribute("array"))
			var v=element.getAttribute("item")
			var i=element.getAttribute("index")
			if(!(a instanceof Object || "string"==typeof a)
			|| !/^(\$|[^\W\d])[\w$]*$/.test(i)
			|| !/^(\$|[^\W\d])[\w$]*$/.test(v))
			{
				this.internalQueue.push(
					new SCxml.Error("error.execution",element))
				throw "invalid item, index or array (see http://www.w3.org/TR/scxml/#foreach)"
			}
			for(var k in a)
			{
				if(i) this.datamodel[i]=k
				if(v) this.datamodel[v]=a[k]
				for(c=element.firstElementChild; c; c=c.nextElementSibling)
					this.execute(c)
			}
			break
		case "script":
			this.expr(element.textContent,element)
			break
			
		default:
			while(c)
			{
				this.execute(c)
				c=c.nextElementSibling
			}
		}
	},
	
	// returns a list of all transitions for an event (or eventless),
	// in document order
	selectTransitions: function(event)
	{
		function filter(e)
		{
			if(e.nodeType!=1 || e.tagName!="transition") return false
			if(event) return e.hasAttribute("event") && event.match(e)
			else return !e.hasAttribute("event")
		}
		var trans=[]
		var conf=this.sortedConfiguration()
		for(var i=0; i<conf.length; i++)
		{
			var cs=conf[i].childNodes
			for(var c=0; c<cs.length; c++) if(filter(cs[c]))
				trans.push(cs[c])
		}
		return trans
	},
	
	mainEventLoop: function()
	{
		// first try eventless transition
		var trans=this.selectTransitions()
		for(t in trans) try{
			if(!trans[t].hasAttribute("cond")
			|| this.expr(trans[t].getAttribute("cond")))
				return this.takeTransition(trans[t])
			} catch(err) {continue}
		
		// if none is enabled, consume internal events
		var event
		while(event=this.internalQueue.shift())
		{
			this.datamodel._event=event
			trans=this.selectTransitions(event)
			for(t in trans) try{
				if(!trans[t].hasAttribute("cond")
				|| this.expr(trans[t].getAttribute("cond")))
					return this.takeTransition(trans[t])
			} catch(err) {continue}
		}
		
		// if we reach here, no transition could be used
		console.log(this.name+": macrostep completed.")
		this.stable=true
		this.extEventLoop()
	},

	extEventLoop: function()
	{
		this.stable=false
		// consume external events
		var event
		while(event=this.externalQueue.shift())
		{
			this.datamodel._event=event
			trans=this.selectTransitions(event)
			for(t in trans) try{
				if(!trans[t].hasAttribute("cond")
				|| this.expr(trans[t].getAttribute("cond")))
					return this.takeTransition(trans[t])
			} catch(err) {continue}
		}
		
		// if we reach here, no transition could be used
		this.stable=true
		console.log(this.name+": waiting for external events.")
	},
	
	// try to follow a transition, after exiting the source state
	takeTransition: function(trans)
	{
		var id=trans.getAttribute("target")
		var state=this.dom.getElementById(id)
		var parent=trans.parentNode
		console.log("transition to "+id+" from "+parent.getAttribute("id"))

		// find the closest common parent
		while((parent=parent.parentNode).tagName!="scxml")
			if(this.dom.querySelector("#"+ parent.getAttribute('id') +" > #"+id))
				break

		this.exitState(trans.parentNode, parent)
		
		// now, between exit and entry, run the executable content if present
		this.execute(trans)
		
		if(!state) throw this.name+": transition target id='"+id+"' not found."
		this.enterState(state)
	},
	
	// returns the configuration, ordered, as an array
	sortedConfiguration: function ()
	{
		var conf=[]
		var leaves={}
		var c
		for(var i in this.configuration)
			leaves[i]=this.configuration[i]
		
		for(i in this.configuration) 
		if(this.configuration[i].parentNode.nodeName!="scxml")
			delete leaves[this.configuration[i].parentNode.getAttribute('id')]
		
		for(i in leaves)
		{
			conf.push(c=leaves[i])
			c.visited=true
			while((c=c.parentNode).nodeName!="scxml")
				if(!c.visited)
				{
					c.visited=true
					conf.push(c)
				}
		}
		for(var i in this.configuration)
			this.configuration[i].visited=false
		return conf
	},
	
	// handles external events
	onEvent:function (event)
	{
		if(!this.running)
			throw this.name+" has terminated and cannot process more events"
		this.externalQueue.push(event)
		if(this.stable)
			this.extEventLoop()
	}
	
}

SCxml.send=function (target, event)
{
	console.log("sending a "+event.name+" event to "+target)
	var sid
	if((sid=target.match(/^#_scxml_(.+)$/)) && (sid=sid[1]))
	{
		if(sid in SCxml.sessions && SCxml.sessions[sid])
			SCxml.sessions[sid].onEvent(event)
		else throw "target SCXML session doesn't exist"
	}
	else {} // TODO
}

SCxml.STATE_ELEMENTS={state: 'state', parallel: 'parallel',
	initial: 'initial', 'final': 'final'}
