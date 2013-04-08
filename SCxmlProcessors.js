
SCxml.EventProcessors={
	SCXML:{
		name:"http://www.w3.org/TR/scxml/#SCXMLEventProcessor",
		createEvent: function(name, sc, data)
		{
			return new SCxml.ExternalEvent(name, "#_scxml_"+sc.sid,
				SCxml.EventProcessors.SCXML.name, undefined, data)
		},
		send: function(event, target, element, sc)
		{
			if(sc.sendNoMore) return;
			target=target||"#_scxml_"+sc.sid
			console.log("sending a "+event.name+" event to "+target)
			var sid
			if((sid=target.match(/^#_scxml_(.+)$/)) && (sid=sid[1]))
			{
				if(sid in SCxml.sessions && SCxml.sessions[sid])
					SCxml.sessions[sid].onEvent(event)
				else sc.error("communication",element,
					new Error('target session "'+target+'" does not exist'))
			}
			else if(target.match(/^#_parent$/))
			{
				if(sc.parent){
					event.invokeid=sc.iid
					sc.parent.onEvent(event)
				}
				else sc.error("communication",element,
					new Error('this session has no #_parent'))
			}
			else if((sid=target.match(/^#_(.+)$/)) && (sid=sid[1]))
			{
				if(sid in sc.invoked)
					sc.invoked[sid].onEvent(event)
				else sc.error("communication",element,
					new Error('invoked target "'+target+'" does not exist'))
			}
			else {
				sc.error("execution",element,
					new Error('unsupported target "'+target+'" for SCXML events'))
			} // TODO: remote targets
		}
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
			if(sc.sendNoMore) return;
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
