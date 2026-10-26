const stages = ['Created','Picked up','At warehouse','Out for delivery','Delivered'];
function transition(order, next) {
 if (stages.indexOf(next)!==stages.indexOf(order.status)+1) throw Error('Complete the preceding stage first');
 if (next==='Out for delivery' && order.items.some(i=>!i.received)) throw Error('Every item must be received before dispatch; partial delivery is not allowed');
 return {...order,status:next};
}
module.exports={stages,transition};
