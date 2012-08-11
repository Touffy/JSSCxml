

SCxml.stateFilter={acceptNode: function(node){ return 2-(node.tagName in SCxml.STATE_ELEMENTS) }}


SCxml.tagNameFilter=function (tagName)
{
	return {acceptNode: function(node)
	{
		if(node.tagName==tagName) return 1
		return 2
	}}
}

SCxml.activeStateFilter={acceptNode: function(node)
{
	if(!(node.tagName in SCxml.STATE_ELEMENTS
	&& node.getAttribute("active")))
		return 2
	return 1
}}
