
SCxml.EventProcessors={
	SCXML:{
		name:"http://www.w3.org/TR/scxml/#SCXMLEventProcessor",
		createEvent: function(name, sc, data)
		{
			return new SCxml.ExternalEvent(name, sc.sid, "", "", data)
		},
		send: function(event, target, element, sc)
		{
			console.log("sending a "+event.name+" event to "+target)
			var sid
			if((sid=target.match(/^#_scxml_(.+)$/)) && (sid=sid[1]))
			{
				if(sid in SCxml.sessions && SCxml.sessions[sid])
					SCxml.sessions[sid].onEvent(event)
				else throw "target SCXML session doesn't exist"
			}
			else {
				sc.error("execution",element,
					new Error('unsupported target "'+target+'" for SCXML events'))
			} // TODO
		}
	},
	basichttp:{
		name:"http://www.w3.org/TR/scxml/#BasicHTTPEventProcessor"
	},
	DOM:{
		name:"http://www.w3.org/TR/scxml/#DOMEventProcessor",
		createEvent: function(name, sc, data)
		{
			// this is the ugly DOM 3 version to improve compatibility
			var e=document.createEvent("CustomEvent")
			e.initCustomEvent(name, true, false, data)
			return e
		},
		send: function(event, target, element, sc)
		{
			var obj
			// heuristics to determine target syntax (XPath or CSS)
			if(!target) obj=sc.html
			if(!obj) try{
				if(target[0]=="/") obj=document.evaluate(
					target, sc.html, null, 9, null).singleNodeValue
				if(target[0]=="#") obj=document.querySelector(target)
			}catch(err){ sc.error("execution.DOM",element,err) }
			
			if(!obj) try{ obj=document.evaluate(
				target, sc.html, null, 9, null).singleNodeValue
				}catch(err){}
			if(!obj) try{ obj=document.querySelector(target) }catch(err){}
			
			if(!obj) sc.error("execution.DOM",element,
				new Error('Failed to evaluate "'+target+'" to an existing element'))
			
			console.log("sending a "+event.type+" event to ",obj)
			
			obj.dispatchEvent(event)
		}
	}
}
