
SCxml.prototype.initIframe=function (data)
{
	if(this.datamodel) return;
	
	with(this._iframe_=document.createElement("iframe")){
		className="scxml_script_frame"
		style.display="none"
	}
	document.body.appendChild(this._iframe_)
	this.datamodel=this._iframe_.contentWindow

	with(this.datamodel.document)
	{
		open()
		write('<script>\n'
			+ 'function expr(s,el)\n{\n'
			+ '	try{ with(_jsscxml_predefined_){ return eval(s) } }\n'
			+ '	catch(e){ _sc.error("execution",el,e) }\n'
			+ '}\n'

			+ 'function syntexpr(s,el)\n{\n'
			+ '	try{ with(_jsscxml_predefined_){ return eval(s) } }\n'
			+ '	catch(e){ if(e instanceof SyntaxError) return e\n'
			+ '  else _sc.error("execution",el,e) }\n'
			+ '}\n'
			
			+ 'function call(f, args)\n{\n'
			+ '	try{ with(_jsscxml_predefined_){ return f.call(null, args) } }\n'
			+ '	catch(e){ _sc.error("execution",f,e) }\n'
			+ '}\n'

			+'\n</script>\n')
	}
	
	this.datamodel._sc=this

	// shadow all predefined variables
	this.datamodel._jsscxml_predefined_={}
	for(var i in this.datamodel) if(this.datamodel.hasOwnProperty(i))
		this.datamodel._jsscxml_predefined_[i]=undefined
	 
	this.datamodel.__defineGetter__("_sessionid", function(){return this._sc.sid})
	this.datamodel.__defineSetter__("_sessionid", function(){return this._sc.sid})
	this.datamodel.__defineGetter__("_event", function(){
		return this._sc.lastEvent})
	this.datamodel.__defineSetter__("_event", function(){
		return this._sc.lastEvent})
	this.datamodel.__defineGetter__("_name", function(){return this._sc.name})
	this.datamodel.__defineSetter__("_name", function(){return this._sc.name})
	this.datamodel.__defineGetter__("_ioprocessors", function(){
		return SCxml.EventProcessors })
	this.datamodel.__defineSetter__("_ioprocessors", function(){
		return SCxml.EventProcessors })
	this.datamodel._x={}
	
	if(data) for(i in data) if(data.hasOwnProperty(i))
	{
		if(this.datamodel.hasOwnProperty(i))
			this.datamodel._jsscxml_predefined_[i]=data[i]
		else this.datamodel[i]=data[i]
	}
	
	this.datamodel.document.write('<script>\n'
		+'function In(state){ return state in _sc.configuration }\n'
		+'function setTimeout(){\n'
		+'	return _sc.timeout(arguments)\n}\n'
		+'function setInterval(){\n'
		+'	return _sc.interval(arguments)\n}\n'
		+'function clearTimeout(t){\n'
		+'	return t.cancel()\n}\n'
		+'function clearInterval(t){\n'
		+'	return t.cancel()\n}\n'
		+'</script>\n')
	
	delete this.datamodel._jsscxml_predefined_.setTimeout
	delete this.datamodel._jsscxml_predefined_.setInterval
	delete this.datamodel._jsscxml_predefined_.clearTimeout
	delete this.datamodel._jsscxml_predefined_.clearInterval
}

SCxml.prototype.wrapScript=function (script, element)
{
	this.datamodel._element=element
	this.datamodel.document.write('<script>\n'
		+ 'try{ with(_jsscxml_predefined_){\n' + script
		+ '\n}} catch(err){_sc.error("execution", _element, err)}\n</script>')
}
