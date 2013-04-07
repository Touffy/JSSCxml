SCxml.prototype.pauseNext=function(macrostep)
{
	this.nextPauseBefore=2-!!macrostep
	if(this.stable) this.pause()
}
	
SCxml.prototype.mainEventLoop=function()
{
	while(this.running && !this.stable){
		if(this.nextPauseBefore==1) return this.pause()
		if(this.autoPauseBefore==1) this.nextPauseBefore=1
		this.macrostep()
		if(this.paused) return;
		if(!this.running) return this.terminate()
		
		if(this.invokeAll()) return; // because invocation is asynchronous
		
		this.stable=true
		this.extEventLoop()
		if(!this.running) return this.terminate()
	}
	this.invokedReady()
}

SCxml.prototype.macrostep=function()
{
	while(this.running){
		if(this.nextPauseBefore==2) return this.pause()
		if(this.autoPauseBefore==2) this.nextPauseBefore=2
		// first try eventless transition
		var trans=this.selectTransitions(null)
		if(!trans.length){
			// if none is enabled, consume internal events
			var event
			while(event=this.internalQueue.shift())
			{
				this.html.dispatchEvent(new CustomEvent("consume", {detail:"internal"}))
				this.datamodel._event=event
				trans=this.selectTransitions(event)
				if(trans.length) break
			}
		}
		if(trans.length) this.takeTransitions(trans)
		else break
	}
}

// NEVER call this directly, use pauseNext() instead
SCxml.prototype.pause=function()
{
	if(this.paused || !this.running) return;
	this.paused=true
	this.html.dispatchEvent(new Event("pause"))
	// todo: pause timers
}

// resume a running SC
SCxml.prototype.resume=function()
{
	if(!this.running || !this.paused) return;
	this.nextPauseBefore=0
	this.paused=false
	this.html.dispatchEvent(new Event("resume"))
	this.mainEventLoop()
}
