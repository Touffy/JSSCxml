JSSCxml
=======

A JavaScript State Chart interpreter that should fully implement the W3C's upcoming [SCXML recommendation](http://www.w3.org/TR/scxml/) in Web browsers.

The name should be pronounced "JessieXML" or just "Jessie".

It is distributed under a MIT license.


### Development status

You can't `<send>` or receive remote events (of any type) with I/O Processors, but you can already use the included custom `<fetch>` element to get similar results in a client-server fashion.

JSSC does not yet support `<invoke>`, nor, as mentionned above, sending SCXML events over HTTP. Support is planned for listening for remote events (from predefined hosts).

### Known issues
(that I'm not going to fix right now)

- Variables whose name matched a predefined window variable are pre-declared in the datamodel. They will never cause an error if you try to assign to them without an explicit declaration. Also, you should never delete them.

- The JavaScript expression in the `location` attribute of an `<assign>` element is currently being evaluated twice while executing the `<assign>`. That could cause a bug if it has side-effects. You should perform any such actions in a `<script>`, and use read-only expressions in `location` attributes. Or you can just write the whole assignment in a `<script>`, of course.

- In ECMAScript content, the keyword "this" references a hidden window by default. You should only use it in constructors and object methods, never in a default context, unless you really know what you're doing.