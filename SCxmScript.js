/* JSSCxml needs a large overhead to interpret global var statements corretly
   in <script> elements within your SCXML. It is enabled by default.
   However, if you rewrite your global variable declarations by using <data>
   elements or the built-in _x.declare() method, you can turn off
   that expensive interpretation overhead. See _x.declare in the main file.
   
   If you have done it and wish to turn off this code,
   simply do not include this script in your page.
*/
   
SCxml.ENABLE_VAR=true

SCxml.prototype.initIframe=function ()
{
	if(this.iframe) return;
	
	var i=document.createElement("iframe")
	i.className="scxml_script_frame"
	i.style.display="none"
	document.body.appendChild(i)
	this.iframe=i.contentWindow
}

SCxml.prototype.wrapScript=function (script)
{
	with(this.iframe.document)
	{
		open()
		write('<script>\n'
			+ 'for(i in window) if(window.hasOwnProperty(i))\n'
			+ '	_jsscxml_predefined_[i]=window[i]\n'
			+ 'delete i\n\n'
			+ 'try{ with(window.parent.SCxml.sessions['+this.sid+'].datamodel){\n'
			+ script
			+ '\n}} catch(err){window.parent.SCxml.sessions['
			+ this.sid+'].error("execution", "", err)}')
		close()
	}
	for(var i in this.iframe) if(this.iframe.hasOwnProperty(i)
	&& (!this.iframe._jsscxml_predefined_.hasOwnProperty(i)
		|| this.iframe._jsscxml_predefined_[i]!=this.iframe[i]))
		this.datamodel[i]=this.iframe[i]
	
}