if(!("http://www.jsscxml.org" in SCxml.executableContentNS))
	SCxml.executableContentNS["http://www.jsscxml.org"]={_support_:{}}

with({exc:SCxml.executableContentNS["http://www.jsscxml.org"]}){

exc._support_.speakEvent=function(de, sc){
	var e=new SCxml.ExternalEvent("speak."+de.type, de.target,
		SCxml.EventProcessors.DOM.name, null, {
			elapsedTime: de.elapsedTime,
			charIndex: de.charIndex,
			name: de.name })
	e.timeStamp=de.timeStamp
	sc.fireEvent(e)
}

exc.speak=function(sc, element)
{
	var text=element.getAttribute("text")
		||sc.expr(element.getAttribute("expr"), element)
	if(!text) sc.error("execution",element,
		new Error('cannot speak an empty string'))
	var s=new SpeechSynthesisUtterance(text)
	s.onerror=function(e){sc.error("execution.speak", element, e)}

	s.lang=element.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang")
		||element.getAttribute("lang")
		||sc.expr(element.getAttribute("langexpr"), element)
		||sc.dom.documentElement.getAttributeNS(
			"http://www.w3.org/XML/1998/namespace", "lang")
		||sc.dom.documentElement.getAttribute("lang")

	if((s.voice=sc.expr(element.getAttribute("voice"), element))
	&& 'voiceURI' in s.voice) s.voiceURI=s.voice.voiceURI
	s.rate=+sc.expr(element.getAttribute("rate"), element) || 1
	s.pitch=+sc.expr(element.getAttribute("pitch"), element) || 1
	s.volume=+sc.expr(element.getAttribute("volume"), element) || 1
	
	s.onend=function(e){exc._support_.speakEvent(e, sc)}
	s.onmark=function(e){exc._support_.speakEvent(e, sc)}
	s.onboundary=function(e){exc._support_.speakEvent(e, sc)}

	speechSynthesis.speak(s)
}

SCxml.executableContentNS.tolerate.speak=exc.speak

}