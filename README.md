JSSCxml
=======

A JavaScript State Chart interpreter that should fully implement the W3C's upcoming [SCXML recommendation](http://www.w3.org/TR/scxml/) in Web browsers.

The name should be pronounced "JessieXML".


### Development status

The interpreter is currently limited to local events (you can send/receive events between SCs inside the same browser window, receive external events from JavaScript within that window, and fire back DOM events).

It is also limited to local JavaScript data and external SCXML files fetched through XmlHttpRequest.


### Known issues
(that I'm not going to fix right now)

- Variable and function declarations in `<script>` content will result in declarations in the global (`window`) scope instead of the SC's _datamodel_. Until this is fixed, you should always declare top-level variables by using `<data>` elements.

- The JavaScript expression in the `location` attribute of an `<assign>` element is currently being evaluated more than once while executing the `<assign>`, and is also evaluated in `window` scope. That could cause a bug if it affects the _datamodel_ (e.g. increments a counter, creates a new object or a new list item, prior to assignment). You should perform any such actions in a `<script>`, and use read-only expressions in `location` attributes. Or you can just write the whole assignment in a `<script>`, of course.
