const {test}=require('node:test');const assert=require('node:assert/strict');const {transition}=require('../domain');
test('cannot dispatch an incomplete multi-vendor order',()=>assert.throws(()=>transition({status:'At warehouse',items:[{received:true},{received:false}]},'Out for delivery'),/Every item/));
test('dispatches a fully consolidated order',()=>assert.equal(transition({status:'At warehouse',items:[{received:true},{received:true}]},'Out for delivery').status,'Out for delivery'));
test('cannot skip pickup or warehouse',()=>assert.throws(()=>transition({status:'Created',items:[]},'Out for delivery'),/preceding/));
