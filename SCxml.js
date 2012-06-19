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
	
	// not (properly) ordered yet
	this.configuration={}
	this.datamodel={}
	
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

/*
This is a tiny constructor for SCXML internal events,
since the browser's built-in DOM Events are not
ideally suited for that role.
*/
SCxml.Event=function SCxmlEvent(name, src)
{
	this.name=name
	this.srcElement=src
	this.timestamp=new Date().getTime()
}
SCxml.Event.prototype.toString=function ()
{ return "SCxmlEvent("+this.name+")" }

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

// matches transitions and events, e.g. "user.*" matches "user.login"
// the first argument is an actual <transtion> element
SCxml.matchEvent=function (t, event)
{
	pattern=t.getAttribute("event").split(".")
	event=event.split(".")
	if(pattern.length>event.length) return false
	for(var i=0; i<pattern.length; i++)
		if(pattern[i]!="*" && pattern[i]!=event[i]) return false
	return true
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
		
		this.running=true
		console.log("The interpreter for "+this.name+" is now ready.")
				
		// find initial state
		if(dom.documentElement.hasAttribute("initial"))
		{
			init=dom.getElementById(dom.documentElement.getAttribute("initial"))
			if(!init) throw "initial state with id='"
				+dom.documentElement.getAttribute("initial")
				+"' not found in "+this.name
		}
		else
			init=dom.querySelector("scxml > *[initial]")
				|| dom.documentElement.firstElementChild
		// and... enter !
		this.enterState( init )
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

		// first add ancestors to the configuration
		if(state.parentNode.tagName != "scxml")
			this.enterState(state.parentNode,true)
		
		// now add this one
		var id=state.getAttribute('id')
		this.configuration[id]=(state)
		
		var onentry=this.dom.querySelectorAll("#"+id+" > onentry")
		for(var i=0; i<onentry.length; i++)
			this.execute(onentry[i])
		
		if(state.tagName=="final")
		{
			if(state.parentNode==this.dom.documentElement)
			{
				this.running=false
				this.stable=true
				console.log(this.name+" reached top-level final state: Terminated.")
				return
			}
			else
				this.internalQueue.push(new SCxml.Event("done.state."
				+state.parentNode.getAttribute("id"), state))
		}
		if(!rec) this.mainEventLoop()
	},
	// remove a state and its ancestors from the configuration,
	// and don't forget to run the onexit blocks
	exitState: function (state)
	{
		if(!(state.tagName in SCxml.STATE_ELEMENTS))
			throw state +" is not a state element."
		
		if(state.parentNode.tagName != "scxml")
			this.exitState(state.parentNode)
		
		var id=state.getAttribute('id')
		
		delete this.configuration[id]
		
		var onexit=this.dom.querySelectorAll("#"+id+" > onexit")
		for(var i=0; i<onexit.length; i++)
			this.execute(onexit[i])
	},

	// wrapper for eval, to handle expr and similar attributes
	// that need to be evaluated as ECMAScript
	expr: function(s)
	{
		// TODO: check that the expr doesn't do horrible stuff
		
		with(this.datamodel){ return eval(s) }
	},
	
	// handles executable content (only <raise> and <log> at this point)
	execute: function (element)
	{
		switch(element.tagName)
		{
		case "raise":
			this.internalQueue.push(new SCxml.Event(
				element.getAttribute("event"), element))
			break
		case "log":
			console.log(element.getAttribute("label")+"="
				+this.expr(element.getAttribute("expr")))
			break
		
		default:
			for(var i=0; i<element.childNodes.length; i++)
			{
				var c=element.childNodes[i]
				if(c.nodeType!=1) continue
				this.execute(c)
			}
		}
	},
	
	// returns a list of all transitions for an event (or eventless)
	// in document order for each state, but the configuration
	// itself is not yet a sorted structure
	selectTransitions: function(event)
	{
		function filter(e)
		{
			if(e.nodeType!=1 || e.tagName!="transition") return false
			if(event)
				return e.hasAttribute("event") && SCxml.matchEvent(e,event)
			else return !cs[c].hasAttribute("event")
		}
		var trans=[]
		for(var s in this.configuration)
			if(this.configuration[s] instanceof Element)
		{
			var cs=this.configuration[s].childNodes
			for(var c=0; c<cs.length; c++) if(filter(cs[c]))
				trans.push(cs[c])
		}
		return trans
	},
	
	mainEventLoop: function()
	{
		// first try eventless transition
		var trans=this.selectTransitions()
		for(t in trans) if(!trans[t].hasAttribute("cond")
		|| this.expr(trans[t].getAttribute("cond")))
			return this.takeTransition(trans[t])
		
		// if none is enabled, consume internal events
		var event
		while(event=this.internalQueue.shift())
		{
			trans=this.selectTransitions(event.name)
			for(t in trans) if(!trans[t].hasAttribute("cond")
			|| this.expr(trans[t].getAttribute("cond")))
				return this.takeTransition(trans[t])
		}
		
		// if we reach here, no transition could be used
		console.log(this.name+": macrostep completed.")
	},
	
	// try to follow a transition, after exiting the source state
	takeTransition: function(trans)
	{
		var id=trans.getAttribute("target")
		console.log("transition to "+id)
		this.exitState(trans.parentNode)
		
		var state=this.dom.getElementById(id)
		if(!state) throw this.name+": transition target id='"+id+"' not found."
		this.enterState(state)
	}
	
}


SCxml.STATE_ELEMENTS={state: 'state', parallel: 'parallel',
	initial: 'initial', 'final': 'final'}
