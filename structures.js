/* CompiledPath :
is a maximal path (each state has exactly one child)

	[State - State - … State - Parallel]
	or
	[State - State - … State - AtomicState]
*/


function CompiledPath(path)
{
	this.parent = path[0].parentNode
	
	this.path = path
	
	this.end = path[path.length-1]
	
	this.atomic = this.end.tagName!="parallel"
}
CompiledPath.prototype.toString=function()
{
	return this.path.map(function(s){return s.getAttribute("id")}).join(" → ")
		+ (this.atomic?"":" ⇉ ")
}

/* CompiledTree:
	
		 +-Path (atomic)
		 |
	Path-+-Path (atomic)
		 |
		 |		+-Path (atomic)
		 +-Path-+
		 		+-Path …

where each branching occurs at the Parallel state at the end of a Path */

function CompiledTree(root, children)
{
	this.parallels={}
	if(!root.atomic) this.parallels[root.end.getAttribute("id")]=this
	this.root=root
	this.children=[]
}
CompiledTree.prototype.toString=function()
{
	return this.root +
		(this.root.atomic?"" : ("(" + this.children.join(" ∥ ") + ")"))
}
CompiledTree.prototype.appendChild=function(subTree)
{
	for(var id in subTree.parallels)
		this.parallels[id] = subTree.parallels[id]
	this.children.push(subTree)
}
CompiledTree.prototype.attach=function(subTree)
{
	var id
	if(!((id=subTree.root.parent.getAttribute("id")) in this.parallels))
		return false
	
	var p=this.parallels[id].children
	
	for(var i=0, c; c=p[i]; i++) if(c.root.path[0] == subTree.root.path[0])
	{
		for(id in c.parallels)
			delete this.parallels[id]
		break
	}
	for(id in subTree.parallels)
		this.parallels[id] = subTree.parallels[id]
	p[i]=subTree
	return true
}
CompiledTree.prototype.inEntryOrder=function()
{
	return this.root.path.concat(this.root.atomic ? [] : this.children.map(function(c){ return c.inEntryOrder() }).reduce(function(a,b){return a.concat(b)})).filter(function(c){return !c.CA})
}

CompiledTree.prototype.atoms=function()
{
	return this.root.atomic ? [this.root.end] : this.children.map(function(c){ return c.atoms() }).reduce(function(a,b){return a.concat(b)})
}

// returns the list of enabled transitions and whether they are all targetless
// 'test' is a function that takes a state as input
// and returns the first matching transition in the state, if any
CompiledTree.prototype.select=function(test)
{
	var enabled=[]
	var allChildrenEnabled=true
	var enabledTargetedTransition=false
	
	if(!this.root.atomic){
		var childSelection
		for(var i=0; i<this.children.length; i++){
			childSelection=this.children[i].select(test)
			if(!childSelection.enabled.length){
				allChildrenEnabled=false
				continue
			}
			enabled=enabled.concat(childSelection.enabled)
			enabledTargetedTransition |= childSelection.hasTargets
		}
	}
	else allChildrenEnabled=false
	
	if(!allChildrenEnabled){
		var t
		for(var p=this.root.path, i=p.length-1; i>=0; i--) if(t=test(p[i])){
			if(!t.targets || !t.targets.size)
				enabled.push(t)
			else{
				if(enabledTargetedTransition) break
				enabled.push(t)
				enabledTargetedTransition=true
			}
			break
		}
	}
	return {hasTargets:enabledTargetedTransition, enabled:enabled}
}
