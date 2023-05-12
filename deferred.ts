
export default class Deferred<A = unknown> implements PromiseLike<A> {
    
    [Symbol.toStringTag] = 'Promise' as const

    then    : Promise<A>['then']
    catch   : Promise<A>['catch']
    finally : Promise<A>['finally']
    
    resolve !: (value: A | PromiseLike<A>) => void
    reject  !: (reason?: unknown) => void
    
    constructor() {
        const promise = new Promise<A>((resolve, reject) => {
            this.resolve = resolve
            this.reject  = reject
        })
        this.then    = (...args) => promise.then   (...args)
        this.catch   = (...args) => promise.catch  (...args)
        this.finally = (...args) => promise.finally(...args)
    }
}