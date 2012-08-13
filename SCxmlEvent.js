/*
Constructors for SCXML events, since the browser's built-in DOM Events
are not ideally suited for that role.
*/

// the basic constructor:
SCxml.Event=function SCxmlEvent(name, type)
{
	this.name=name
	this.timestamp=new Date().getTime()
	this.type=type||"platform"
}

SCxml.Event.prototype.toString=function ()
{ return "SCxmlEvent("+this.name+")" }
SCxml.Event.prototype.match=function (t)
// matches transitions and events, e.g. "user.*" matches "user.login"
// the argument is an actual <transtion> element
{
	pattern=t.getAttribute("event").split(".")
	event=this.name.split(".")
	if(pattern.length>event.length) return false
	for(var i=0; i<pattern.length; i++)
		if(pattern[i]!="*" && pattern[i]!=event[i]) return false
	return true
}


// sub-constructors for internal, error and external events:

SCxml.InternalEvent=function (name, src)
{
	SCxml.Event.call(this, name, "internal")
	this.srcElement=src||null
}
SCxml.InternalEvent.prototype=new SCxml.Event()
SCxml.InternalEvent.prototype.constructor=SCxml.InternalEvent


SCxml.Error=function (name, src, err)
{
	SCxml.Event.call(this, name)
	this.srcElement=src||null
	this.err=err
	if(src && src.tagName=="send")
		this.sendid=src.getAttribute("id")
}
SCxml.Error.prototype=new SCxml.Event()
SCxml.Error.prototype.constructor=SCxml.Error


SCxml.ExternalEvent=function (name, origin, origintype,
	invokeid, data)
{
	SCxml.Event.call(this, name, "external")
	this.origin=origin||""
	this.origintype=origintype||""
	this.invokeid=invokeid||""
	this.data=data||{}
}
SCxml.ExternalEvent.prototype=new SCxml.Event()
SCxml.ExternalEvent.prototype.constructor=SCxml.ExternalEvent

SCxml.ExternalEvent.DOMRefCount=1
SCxml.ExternalEvent.targetOfElement=function (e)
{
	if(e instanceof Element)
		return "//*[@scxmlref=\""+(e.getAttribute("scxmlref")
		|| (e.setAttribute("scxmlref", SCxml.ExternalEvent.DOMRefCount)
			, SCxml.ExternalEvent.DOMRefCount++))+"\"]"
	return e
}

SCxml.ExternalEvent.fromDOMEvent=function (de)
{
	var e=new SCxml.ExternalEvent(de.type,
		SCxml.ExternalEvent.targetOfElement(de.srcElement), "DOM")
	e.timeStamp=de.timeStamp
	
	if(de instanceof CustomEvent)
		e.data=de.detail
	else for(var prop in de) if(de.hasOwnProperty(prop))
		e.data[prop]=SCxml.ExternalEvent.targetOfElement(de[prop])
	return e
}
