
/***** MAIN *****/

export default { from, safeMap }
export { from, safeMap }

function from<A>(
    array : readonly A[],
    queueingStrategy ?: QueuingStrategy<A>
) : ReadableStream<A> {
    let i = 0
    return new ReadableStream(
        {
            pull(controller) {
                if (i === array.length - 1) controller.close()
                controller.enqueue(array[i])
                i++
            }
        },
        queueingStrategy
    )
}

function safeMap<A, B>(
    stream      : ReadableStream<A>,
    mapFunction : (element: Exclude<A, Error>) => B,
    queueingStrategy ?: QueuingStrategy<Awaited<B> | Extract<A, Error>>
) : ReadableStream<Awaited<B> | Extract<A, Error>> {
    const reader = stream.getReader()
    return new ReadableStream<Awaited<B> | Extract<A, Error>>(
        {
            async pull(controller) {
                const { done, value } = await reader.read()
                if (done)                        controller.close()
                else if (value instanceof Error) controller.enqueue(value as Extract<A, Error>)
                else                             controller.enqueue(await mapFunction(value as Exclude<A, Error>))
            }
        },
       queueingStrategy
    )
}

// function safeMap<A>()
