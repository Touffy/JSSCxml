if(!("http://www.jsscxml.org" in SCxml.executableContentNS))
	SCxml.executableContentNS["http://www.jsscxml.org"]={}

with({exc:SCxml.executableContentNS["http://www.jsscxml.org"]}){

exc._support_={
	xmls:function (o, element){
		if(o instanceof Element || o instanceof Document)
			return new XMLSerializer().serializeToString(o)
		sc.error("execution",element,
			new TypeError('"xml" type requires a Document or Element.'))
	},
	urls:function (o, element){
		if((typeof o)!="object")
			sc.error("execution",element,new TypeError(
			'"url" type requires an object with enumerable properties.'))
		var s=[]
		for(k in o) if(o.hasOwnProperty(k)) s.push(k+"="+encodeURIComponent(o[k]))
		return s.join("&")
	},
	mime:{ // default Content-Type for each <fetch> type
		"json": "application/json",
		"xml": "application/xml",
		"url": "application/x-www-form-urlencoded",
		"text": "text/plain"
	},
	Request:function(target, caller, callback, headers, postData)
	{
		this.target=target
		this.callback=callback
		this.caller=caller
		var xhr=this
		
		with(this.req=new XMLHttpRequest())
		{
			open(postData?"POST":"GET",target,true)
			onload = function(){ xhr.caller.fireEvent(
				new SCxml.ExternalEvent(xhr.callback+".done",
				xhr.target, "http", null, xhr.req))
			}
			onerror = function(e){
				if(xhr.bad) return;
				xhr.caller.fireEvent(new SCxml.ExternalEvent(
				xhr.callback+".failed", xhr.target, "http", null, xhr.req))
			}
			for(var h in headers)
				setRequestHeader(h, headers[h])
			try{send(postData || null)}
			catch(err){
				this.bad=true
				caller.error( "communication."+callback, target, err, true)
			}
		}
	}
}
exc._support_.types={
	"json": JSON.stringify,
	"xml": exc._support_.xmls,
	"url": exc._support_.urls,
	"text": String
}


SCxml.prototype.readHeaders=function(element, headers)
{
	for(var c=element.firstElementChild; c; c=c.nextElementSibling)
	if(c.localName=="header"){
		var name=c.getAttribute("name")
		var value=c.getAttribute("value") || this.expr(c.getAttribute("expr"), c)
		if(name && value) headers[name] = value
	}
}

exc.fetch=function(sc, element)
{
	var target=element.getAttribute("target")
		||sc.expr(element.getAttribute("targetexpr"), element)
	var event=element.getAttribute("callback")
		||sc.expr(element.getAttribute("callbackexpr"), element)

	var type=element.getAttribute("type")||element.getAttribute("enctype")
		||sc.expr(element.getAttribute("typeexpr"), element)
		||sc.expr(element.getAttribute("enctypeexpr"), element)
		||"text"
	var proc
	if(type in exc._support_.types)
		proc=exc._support_.types[type]
	if("function" != typeof proc)
		sc.error("execution",element,
			new Error('unsupported fetch enctype "'+type+'"'))

	var namelist=element.getAttribute("namelist")
	var data={}
	if(namelist)
	{
		namelist=namelist.split(/\s+/)
		for(var i=0, name; name=namelist[i]; i++)
			data[name]=sc.expr(name)
	}
	sc.readParams(element, data)
	var headers={"Content-Type":exc._support_.mime[type]}
	sc.readHeaders(element, headers)
	var c=element.firstElementChild
	if(c && c.tagName=="content") data=c.textContent
	
	new exc._support_.Request(target, sc, event, headers, proc(data))
}

SCxml.executableContentNS.tolerate.fetch=exc.fetch

}