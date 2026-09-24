// Расширения браузера (переводчик, VPN, блокировщики, проверка орфографии) иногда
// переставляют или оборачивают узлы страницы. При следующем переходе React пытается убрать
// «свой» узел, которого уже нет на прежнем месте, и страница падает с ошибкой
// «removeChild/insertBefore: … is not a child of this node». Такую операцию пропускаем
// (узел и так уже не там) и один раз пишем в журнал — страница продолжает работать.
import { reportError } from './errors';

let installed = false;

export function installDomGuard() {
  if (installed || typeof Node !== 'function' || !Node.prototype) return;
  installed = true;
  const removeChild = Node.prototype.removeChild;
  const insertBefore = Node.prototype.insertBefore;

  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      reportError(new Error('removeChild: узел уже перемещён расширением браузера'), 'dom-guard');
      return child;
    }
    return removeChild.call(this, child) as T;
  };

  Node.prototype.insertBefore = function <T extends Node>(this: Node, node: T, ref: Node | null): T {
    if (ref && ref.parentNode !== this) {
      reportError(new Error('insertBefore: опорный узел перемещён расширением браузера'), 'dom-guard');
      return node;
    }
    return insertBefore.call(this, node, ref) as T;
  };
}
