/* ===================================================================
   algoInfoData.js: content of the Algorithm Information page.
   Notation: b = branching factor (at most 4 for the 8-puzzle),
             l = depth limit, d = depth of the shallowest goal.
   =================================================================== */

const ALGO_INFO = {
  name: 'Depth Limited Search (DLS)',
  category: 'Uninformed (blind) search',

  description:
    'Depth Limited Search is Depth-First Search with a depth limit l. It follows one branch as deep as it is ' +
    'allowed, treats every node at depth l as if it had no successors, and then backtracks to try the next ' +
    'branch. The limit stops DFS from wandering down an endless path, but it adds a new problem: if the ' +
    'shallowest goal is deeper than l, DLS cannot find it.',

  principle: [
    'Put the initial state on a LIFO stack (the frontier) at depth 0.',
    'Pop the top node and check whether it is the goal. If it is, return the path to it.',
    'If the node is at depth l, do not expand it. Note that a cutoff happened and go back to step 2.',
    'Otherwise expand it: generate every legal successor (blank Up, Down, Left, Right), drop the ones that only repeat a state, and push the rest with depth + 1.',
    'Repeat from step 2. When the stack is empty, report a cutoff if any branch was truncated (a deeper solution may exist) or a failure if none was (there is no solution).'
  ],

  advantages: [
    'Always terminates, even on a graph full of loops like the 8-puzzle, because no path can be longer than l.',
    'Tiny memory footprint in its pure form: just the current path and its unexpanded siblings, O(b\u00B7l).',
    'Simple to implement, and fast when the goal is shallow and l is chosen well.',
    'Tells "no solution within l" (cutoff) apart from "no solution at all" (failure).',
    'The building block of Iterative Deepening Search [2], which removes the need to guess l.'
  ],

  limitations: [
    'Incomplete when l < d: a goal deeper than the limit is never found (the result is a cutoff).',
    'Not optimal: it returns the first goal it meets, which can be much deeper than the shallowest one.',
    'Choosing l is a guess. Too small gives cutoffs, too large wastes time in deep, useless branches.',
    'Time grows exponentially with l, O(b^l).',
    'It is uninformed: nothing steers it toward the goal.'
  ],

  properties: [
    { label: 'Time Complexity',  value: 'O(b^l)', detail: 'In the worst case every node down to depth l is generated. For the 8-puzzle b is at most 4.' },
    { label: 'Space Complexity', value: 'O(b\u00B7l)', detail: 'Only one path of length l plus its unexpanded siblings. This app also keeps a table of expanded states, which uses more memory but saves a lot of time.' },
    { label: 'Completeness',     value: 'Only if l \u2265 d', detail: 'If l < d the goal lies beyond the horizon. If l \u2265 d, DLS is guaranteed to find some solution.' },
    { label: 'Optimality',       value: 'No', detail: 'The first solution found need not be the shortest. It is optimal only when l = d.' }
  ],

  pseudocode:
`function DLS(problem, l):
    frontier <- stack with the initial node
    cutoff <- false
    while frontier is not empty:
        node <- pop(frontier)
        if goal-test(node.state): return solution(node)
        if depth(node) = l:
            cutoff <- true       // do not expand
        else:
            for each child of expand(node):
                if child is not a repeated state:
                    push(child, frontier)
    return "cutoff" if cutoff else "failure"`,

  implementation: [
    'Moves are always tried in the same order (Up, Down, Left, Right, meaning where the blank goes), so the same puzzle gives the same result every time.',
    'The goal check happens when a node is taken off the stack, not when it is created.',
    'To avoid going in circles, a state is skipped if it was already expanded at the same or a shallower depth. If a state is reached again by a shorter route, it is expanded again, so the answer stays correct for the chosen limit.',
    '"Generated" counts every child created (plus the start node). "Expanded" counts the nodes we actually opened up. Nodes sitting at the depth limit are counted separately as "cut off".',
    'The time shown comes from a separate run that records nothing, so the animation does not slow it down. Memory is a rough estimate based on the stack size and the table of expanded states.',
    'If a search ever passes 300,000 node visits, it stops and says so instead of freezing the page.'
  ],

  references: [
    'S. Russell and P. Norvig, <i>Artificial Intelligence: A Modern Approach</i>, 4th ed. Hoboken, NJ, USA: Pearson, 2020, sec. 3.4.',
    'R. E. Korf, \u201CDepth-first iterative-deepening: An optimal admissible tree search,\u201D <i>Artif. Intell.</i>, vol. 27, no. 1, pp. 97\u2013109, Sep. 1985.'
  ]
};
