interface Node {
    [_: string]: Node | Leaf
}

type Leaf = number

function parent(
    tree: Node,
    child: Node | Leaf
) {
    let parent: Node | undefined
    walk(tree, (_, value) => {
        if (isNode(value) && Object.values(value).includes(child)) parent = value
    })
    return parent
}

function parents(
    tree : Node
) {
    const parents = new Set<Node>()
    walk(tree, (_, leaf, __, parent) => {
        if (isLeaf(leaf)) parents.add(parent)
    })
    return parents
}

function children(
    tree : Node
) {
    return Object.values(tree)
}

function ancestors(
    tree : Node,
    child : Node | Leaf
) {
    const ancestors = new Set<Node>()
    let node : Node | Leaf | undefined  = child
    while (true) {
        node = parent(tree, node)
        if (node === undefined) break
        ancestors.add(node)
    }
    return ancestors
}

function nodes(tree : Node) {
    const parents = new Set<Node>()
    walk(tree, (_, value) => {
        if (typeof value === 'object') parents.add(value)
    })
    return parents
}

function leaves(tree : Node) {
    const leaves = new Set<Leaf>()
    walk(tree, (_, value) => {
        if (isLeaf(value)) leaves.add(value)
    })
    return leaves
}

function everyLeaf(
    tree : Node,
    callback : (leaf: Leaf, parent : Node) => boolean
) {
    let result = true
    walk(tree, (_, value, __, parent) => {
        result = result && (isNode(value) || callback(value, parent))
    })
    return result
}

function someLeaves(
    tree : Node,
    callback : (leaf: Leaf, parent : Node) => boolean
) {
    let result = false
    walk(tree, (_, value, __, parent) => {
        result = result || (isLeaf(value) && callback(value, parent))
    })
    return result
}

function type(value : Node | Leaf) {
    return typeof value === 'number' ? 'leaf' : 'node'
}

function isLeaf(value : Node | Leaf) : value is Leaf {
    return typeof value === 'number'
}

function isNode(value : Node | Leaf) : value is Node {
    return typeof value === 'object'
}

function parentCount(tree : Node) {
    let count = 0
    walk(tree, (_, value) => {
        if (typeof value === 'object') count++
    })
    return count
}

function leafCount(tree : Node) {
    let count = 0
    walk(tree, (_, value) => {
        if (typeof value === 'symbol') count++
    })
    return count
}

function firstChild(tree : Node) {
    return Object.values(tree).at(0)
}

function clone(tree : Node) : Node {
    return JSON.parse(JSON.stringify(tree))
}

function walk(
    tree: Node, 
    callback: (key : string, value : Node | Leaf, index : number, parent : Node) => void
) {
    const keys = Object.keys(tree)
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        const value = tree[key]
        callback(key, value, i, tree)
        if (isNode(value)) walk(value, callback)
    }
}

// a bunch of file paths -> directory tree
function fromPaths(
    paths   : readonly string[],
    splitAt : string
) {
    const root: Node = {}
    for (let i = 0; i < paths.length; i++) {
        const pathParts = paths[i].split(splitAt)
        let current = root
        for (let j = 0; j < pathParts.length; j++) {
            const part = pathParts[j]
            if (j === pathParts.length - 1) current[part] = i
            // @ts-ignore this is fine
            else current = current[part] ??= {}
        }
    }
    return root
}

// combines directory names if there is only one subfolder or file in it
function simplify(
    root     : Node,
    joinWith : string
) {
    const keys = Object.keys(root)
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        const value = root[key]
        if (isLeaf(value)) continue
        const childKeys = Object.keys(value)
        if (childKeys.length === 1) {
            const childKey = childKeys[0]
            const childValue = value[childKey]
            const newKey = key + joinWith + childKey
            delete root[key]
            root[newKey] = childValue
            simplify(root, joinWith)
        }
        simplify(value, joinWith)
    }
    return root
}

export { fromPaths, simplify, nodes, children, leaves, someLeaves, everyLeaf, type, isLeaf, isNode, parent, parents, ancestors, parentCount, leafCount, firstChild, walk, clone, type Node, type Leaf }
