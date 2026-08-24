export interface DirectedEdge {
  id: string;
  from: string;
  to: string;
}

export interface BoundedTrace<Edge extends DirectedEdge> {
  nodes: string[];
  edges: Edge[];
  truncated: boolean;
}

/**
 * Deterministic breadth-first traversal of the authoritative directed network.
 * Edges are expected to be ordered by a stable key before this function is called.
 */
export function boundedDirectedTrace<Edge extends DirectedEdge>(
  start: string,
  edges: readonly Edge[],
  direction: 'upstream' | 'downstream',
  cap = 250,
): BoundedTrace<Edge> {
  const seenNodes = new Set([start]);
  const seenEdges = new Set<string>();
  const nodes = [start];
  const picked: Edge[] = [];
  const queue = [start];
  let truncated = false;

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      const matches = direction === 'downstream' ? edge.from === current : edge.to === current;
      if (!matches || seenEdges.has(edge.id)) continue;
      if (picked.length === cap) {
        truncated = true;
        continue;
      }
      seenEdges.add(edge.id);
      picked.push(edge);
      const next = direction === 'downstream' ? edge.to : edge.from;
      if (!seenNodes.has(next)) {
        seenNodes.add(next);
        nodes.push(next);
        queue.push(next);
      }
    }
  }

  return { nodes, edges: picked, truncated };
}
