
/***** MAIN *****/

const Series = { from }

export default Series

interface Series<A> extends AsyncIterable<A> {
    every                     (predicate : (element: A) => MaybePromise<boolean>) : Promise<boolean>
    filter       <B extends A>(predicate : (element: A) => element is B)          : Series<B>
    filter                    (predicate : (element: A) => MaybePromise<boolean>) : Series<A>
    find     <B extends A = A>(predicate : (element: A) => element is B)          : Promise<B | undefined>
    find                      (predicate : (element: A) => MaybePromise<boolean>) : Promise<A | undefined>
    map                    <B>(mapFun    : (element: A) => B)                     : Series<Awaited<B>>
    partition<B extends A = A>(predicate : (element: A) => element is B)          : [ Series<Extract<A, B>>, Series<Exclude<A, B>> ]
    partition                 (predicate : (element: A) => MaybePromise<boolean>) : [ Series<A>, Series<A> ]
    safeMap                <B>(mapFun    : (element: Exclude<A, Error>) => B)     : Series<Awaited<B> | Extract<A, Error>>,
    some                      (predicate : (element: A) => MaybePromise<boolean>) : Promise<boolean>
    tee                       ()                                                  : [ Series<A>, Series<A> ]
    toArray                   ()                                                  : Promise<Awaited<A>[]>
    toReiterable              ()                                                  : Series<A>
    toStream                  (queueingStrategy ?: QueuingStrategy<A>)            : ReadableStream<A>
}

function from<A>(source : Iterable<MaybePromise<A>> | AsyncIterable<A>) : Series<A> {
    
    if (Symbol.iterator in source) return from(arrayToAsyncIterable(source))
    
    return {
        [Symbol.asyncIterator]    ()                                                  { return source[Symbol.asyncIterator]()      },
        every                     (predicate : (element: A) => MaybePromise<boolean>) { return every(source, predicate)            },
        filter                    (predicate : (element: A) => MaybePromise<boolean>) { return from(filter(source, predicate))     },
        find                      (predicate : (element: A) => MaybePromise<boolean>) { return find(source, predicate)             },
        map                    <B>(mapFun    : (element: A) => B)                     { return from(map(source, mapFun))           },
        partition<B extends A = A>(predicate : (element: A) => element is B)          { return from2(partition(source, predicate)) },
        safeMap                <B>(mapFun    : (element: Exclude<A, Error>) => B)     { return from(safeMap(source, mapFun))       },
        some                      (predicate : (element: A) => MaybePromise<boolean>) { return some(source, predicate)             },
        tee                       ()                                                  { return from2(tee(source))                  },
        toArray                   ()                                                  { return toArray(source)                     },
        toReiterable              ()                                                  { return from(toReiterable(source))          },
        toStream                  (queueingStrategy ?: QueuingStrategy<A>)            { return toStream(source, queueingStrategy)  }
    }
}


/***** IMPLEMENTATIONS *****/

function arrayToAsyncIterable<A>(
    array : Iterable<MaybePromise<A>>
) : AsyncIterable<A> {
    const sourceIterator = array[Symbol.iterator]()
    return {
        [Symbol.asyncIterator]() {
            return {
                async next() {
                    const { done, value } = sourceIterator.next()
                    if (done) return { done, value: undefined }
                    return { done: false, value: await value }
                }
            }
        }
    }
}

function filter<A, B extends A>(
    iterable  : AsyncIterable<A>,
    predicate : (element: A) => element is B
) : AsyncIterable<B>

function filter<A>(
    iterable  : AsyncIterable<A>,
    predicate : (element: A) => MaybePromise<boolean>
) : AsyncIterable<A>

function filter<A, B extends A>(
    iterable  : AsyncIterable<A>,
    predicate : ((element: A) => element is B) | ((element: A) => MaybePromise<boolean>)
) : AsyncIterable<A> {
    const sourceIterator = iterable[Symbol.asyncIterator]()
    return {
        [Symbol.asyncIterator]() {
            return {
                async next() {
                    return await filterResult(sourceIterator, predicate)
                }
            }
        }
    }
}

function tee<A>(
    iterable : AsyncIterable<A>
) : [ AsyncIterable<A>, AsyncIterable<A> ] {
    const sourceIterator = iterable[Symbol.asyncIterator]()
    const leftQueue      = new Array<A>
    const rightQueue     = new Array<A>
    
    async function leftNext() : Promise<IteratorResult<A>> {
        const buffered = leftQueue.pop()
        if (buffered !== undefined) return { done: false, value: buffered }
        const { done, value } = await sourceIterator.next()
        if (done) return { done, value }
        rightQueue.unshift(value)
        return { done, value }
    }
    
    async function rightNext() : Promise<IteratorResult<A>> {
        const buffered = rightQueue.pop()
        if (buffered !== undefined) return { done: false, value: buffered }
        const { done, value } = await sourceIterator.next()
        if (done) return { done, value }
        leftQueue.unshift(value)
        return { done, value }
    }
    
    const leftIterable = {
        [Symbol.asyncIterator]() {
            return { next: leftNext }
        }
    }
    
    const rightIterable = {
        [Symbol.asyncIterator]() {
            return { next: rightNext }
        }
    }
    
    return [ leftIterable, rightIterable ]
}

function partition<A, B extends A = A>(
    iterable  : AsyncIterable<A>,
    predicate : (element: A) => element is B
) : [ AsyncIterable<Extract<A, B>>, AsyncIterable<Exclude<A, B>> ] {
    const sourceIterator = iterable[Symbol.asyncIterator]()
    const leftQueue      = new Array<Extract<A, B>>
    const rightQueue     = new Array<Exclude<A, B>>
    
    async function leftNext() : Promise<IteratorResult<Extract<A, B>>> {

        const buffered = leftQueue.pop()
        if (buffered !== undefined) return { done: false, value: buffered }
        
        const { done, value } = await sourceIterator.next()
        
        if (done)             return { done, value }
        if (predicate(value)) return { done, value: value as Extract<A, B> }
        
        rightQueue.unshift(value as Exclude<A, B>)
        return leftNext()
    }
    
    async function rightNext() : Promise<IteratorResult<Exclude<A, B>>> {
        
        const buffered = rightQueue.pop()
        if (buffered !== undefined) return { done: false, value: buffered }
        
        const { done, value } = await sourceIterator.next()
        
        if (done)              return { done, value }
        if (!predicate(value)) return { done, value: value as Exclude<A, B> }
        
        leftQueue.unshift(value as Extract<A, B>)
        return rightNext()
    }
    
    const leftIterable = {
        [Symbol.asyncIterator]() {
            return { next: leftNext }
        }
    }
    
    const rightIterable = {
        [Symbol.asyncIterator]() {
            return { next: rightNext }
        }
    }
    
    return [ leftIterable, rightIterable ]
}

function map<A, B>(
    iterable    : AsyncIterable<A>,
    mapFunction : (element: A) => B
) : AsyncIterable<Awaited<B>> {
    const sourceIterator = iterable[Symbol.asyncIterator]()
    return {
        [Symbol.asyncIterator]() {
            return {
                async next() {
                    const { done, value } = await sourceIterator.next()
                    if (done) return { done, value }
                    return { done, value: await mapFunction(value) }
                }
            }
        }
    }
}

function safeMap<A, B>(
    iterable    : AsyncIterable<A>,
    mapFunction : (element: Exclude<A, Error>) => B,
) : AsyncIterable<Awaited<B> | Extract<A, Error>> {
    const sourceIterator = iterable[Symbol.asyncIterator]()
    return {
        [Symbol.asyncIterator]() {
            return {
                async next() {
                    const { done, value } = await sourceIterator.next()
                    if (done)                        return { done, value }
                    else if (value instanceof Error) return { done, value: value as Extract<A, Error> }
                    else                             return { done, value: await mapFunction(value as Exclude<A, Error>) }
                }
            }
        }
    }
}


function toReiterable<A>(
    iterable : AsyncIterable<A>
) : AsyncIterable<A> {
    const sourceIterator = iterable[Symbol.asyncIterator]()   
    const buffer = new Array<A>
    return {
        [Symbol.asyncIterator]() {
            let i = 0
            return {
                async next() {
                    
                    const bufferedValue = buffer[i]
                    if (bufferedValue !== undefined) {
                        return { done: false, value: bufferedValue }
                    }
                    
                    const { done, value } = await sourceIterator.next()
                    if (!done) {
                        i++
                        buffer.push(value)
                    }

                    return { done, value }
                }
            }
        }
    }
}

async function toArray<A>(
    iterable    : AsyncIterable<A>
) : Promise<Awaited<A>[]> {
    const result = new Array<Awaited<A>>
    for await (const element of iterable) result.push(element)
    return result
}

function toStream<A>(
    iterable : AsyncIterable<A>,
    queuingStrategy ?: QueuingStrategy<A>
) : ReadableStream<A> {
    const sourceIterator = iterable[Symbol.asyncIterator]()    
    const underlyingSource : UnderlyingSource<A> = {
        async pull(controller) {
            const { done, value } = await sourceIterator.next()
            if (done) controller.close()
            else controller.enqueue(value)
        }
    }
    return new ReadableStream<A>(underlyingSource, queuingStrategy)
}

async function some<A>(
    iterable  : AsyncIterable<A>,
    predicate : (element: A) => MaybePromise<boolean>
) : Promise<boolean> {
    const sourceIterator = iterable[Symbol.asyncIterator]()
    const { done } = await filterResult(sourceIterator, predicate)
    if (done) return false
    return true
}

async function every<A>(
    iterable  : AsyncIterable<A>,
    predicate : (element: A) => MaybePromise<boolean>
) : Promise<boolean> {
    const sourceIterator = iterable[Symbol.asyncIterator]()
    const { done } = await filterResult(sourceIterator, async element => await predicate(element) === false)
    if (done) return true
    return false
}

async function find<A>(
    iterable  : AsyncIterable<A>,
    predicate : (element: A) => MaybePromise<boolean>
) : Promise<A | undefined> {
    const sourceIterator = iterable[Symbol.asyncIterator]()
    const { done, value } = await filterResult(sourceIterator, predicate)
    if (done) return undefined
    return value
}


/***** UTILITY FUNCTIONS *****/

async function filterResult<A>(
    iterator  : AsyncIterator<A>,
    predicate : (element: A) => MaybePromise<boolean>
) : Promise<IteratorResult<A>> {
    const { done, value } = await iterator.next()
    if (done) return { done, value }
    const matchesCondition = predicate(value)
    if (await matchesCondition === true) return { done, value }
    return filterResult(iterator, predicate)
}

function from2<A, B>(
   [ iterable1, iterable2 ] : [ AsyncIterable<A>, AsyncIterable<B> ]
) : [ Series<A>, Series<B> ] {
    const series1 = from(iterable1)
    const series2 = from(iterable2)
    return [ series1, series2 ]
}


/***** UTILITY TYPES *****/

type MaybePromise<A> = A | Promise<A>
