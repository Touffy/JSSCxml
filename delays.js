/*	Delays:
	wraps setTimeout and setInterval calls so they can be paused and resumed
*/

function Delay(delay, startNow, sc, proc, e, target, element)
{
	this.executed=false
	this.time=delay
	this.event=e
	this.target=target
	this.proc=proc
	this.sc=sc
	this.element=element
	if(startNow) this.start()
	else this.sc.timeouts.push(this)
}

function Timeout(args, startNow, sc)
{
	this.executed=false
	this.time=args[1]
	this.f=args[0]
	this.args=[]
	this.sc=sc
//	this.element=sc.datamodel._element
	for(var i=2; args[i]; i++) this.args.push(args[i])
	if(startNow) this.start()
	else this.sc.timeouts.push(this)
}

Delay.timesUp=function(t){ t.timesUp() }

Delay.prototype.start=Timeout.prototype.start=function()
{
	if(!this.timer && !this.executed)
	{
		this.timer=setTimeout(Delay.timesUp, this.time, this)
		this.started=+new Date()
	}
}
Delay.prototype.cancel=Timeout.prototype.cancel=function()
{
	if(this.timer && !this.executed){
		clearTimeout(this.timer)
		delete this.timer
	}
}
Delay.prototype.stop=Timeout.prototype.stop=function()
{
	if(this.timer && !this.executed && this.sc.running){
		this.time-=new Date()-this.started
		if(this.time<15) return false
		clearTimeout(this.timer)
		delete this.timer
		this.sc.timeouts.push(this)
		return true
	}
	return false
}

Delay.prototype.timesUp=function()
{
	this.executed=true
	with(this) proc.send(event, target, element, sc)
}

Timeout.prototype.timesUp=function()
{
	this.executed=true
	try{
		if((typeof this.f)=="function")
			sc.datamodel.call(f, this.args)
		else sc.datamodel.expr(f, f)
	} catch(err){}
}
