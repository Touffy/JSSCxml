/*
This deals with the details of HTTP requests
used to fetch SCXML docs and to send remote events.
*/

function XHR(target, caller, callback, postData, onerror)
{
	this.target=target
	this.callback=callback
	this.caller=caller
	this.onerror=onerror
	
	with(this.req=new XMLHttpRequest())
	{
		open(postData?"POST":"GET",target,true)
		onreadystatechange=XHR.handler(this)
		overrideMimeType("application/scxml+xml")
		send(postData || null)
	}
}

XHR.handler=function (xhr)
{
	function f()
	{
		if(xhr.req.readyState<4)	return
		if(xhr.req.status == 200)	xhr.callback.call(xhr.caller,xhr)
		else if(xhr.onerror)		xhr.onerror.call(xhr.caller,xhr)
		else throw "HTTP error " + xhr.req.status
				+ " : " + xhr.req.statusText
	}
	return f
}
