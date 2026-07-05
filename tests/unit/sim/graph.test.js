// Tests du graphe de circulation et du pathfinding A*.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Graph } from '../../../sim/graph.js';

// Petit graphe en L : a(0,0) — b(3,0) — c(3,4), plus un raccourci direct a—c
function makeGraph() {
  const g = new Graph();
  g.addNode('a', 0, 0);
  g.addNode('b', 3, 0);
  g.addNode('c', 3, 4);
  g.addEdge('a', 'b');
  g.addEdge('b', 'c');
  return g;
}

test('shortestPath trouve le chemin et sa distance', () => {
  const g = makeGraph();
  const result = g.shortestPath('a', 'c');
  assert.deepEqual(result.path, ['a', 'b', 'c']);
  assert.equal(result.distance, 7);
});

test('shortestPath préfère le raccourci quand il existe', () => {
  const g = makeGraph();
  g.addEdge('a', 'c'); // diagonale de longueur 5
  const result = g.shortestPath('a', 'c');
  assert.deepEqual(result.path, ['a', 'c']);
  assert.equal(result.distance, 5);
});

test('shortestPath du nœud vers lui-même est de distance nulle', () => {
  const g = makeGraph();
  assert.deepEqual(g.shortestPath('b', 'b'), { path: ['b'], distance: 0 });
});

test('une arête à sens unique n’est pas traversable à contresens', () => {
  const g = new Graph();
  g.addNode('a', 0, 0);
  g.addNode('b', 1, 0);
  g.addEdge('a', 'b', { oneWay: true });
  assert.ok(g.shortestPath('a', 'b'));
  assert.equal(g.shortestPath('b', 'a'), null);
});

test('un nœud inatteignable renvoie null', () => {
  const g = makeGraph();
  g.addNode('isole', 10, 10);
  assert.equal(g.shortestPath('a', 'isole'), null);
});

test('un nœud inconnu lève une erreur explicite', () => {
  const g = makeGraph();
  assert.throws(() => g.shortestPath('a', 'zz'), /Nœud inconnu/);
  assert.throws(() => g.distance('zz', 'a'), /Nœud inconnu/);
});

test('un identifiant de nœud dupliqué lève une erreur', () => {
  const g = makeGraph();
  assert.throws(() => g.addNode('a', 1, 1), /dupliqué/);
});

test('distance calcule la distance euclidienne', () => {
  const g = makeGraph();
  assert.equal(g.distance('a', 'c'), 5);
});

test('neighbors liste les arêtes sortantes', () => {
  const g = makeGraph();
  const targets = g.neighbors('b').map((e) => e.to).sort();
  assert.deepEqual(targets, ['a', 'c']);
});

test('le gabarit filtre les arêtes : chemin, atteignabilité, distances', () => {
  const g = new Graph();
  g.addNode('a', 0, 0);
  g.addNode('b', 10, 0);
  g.addNode('c', 20, 0);
  g.addEdge('a', 'b', { width: 3 });
  g.addEdge('b', 'c', { width: 1.4 });
  // Sans contrainte : tout passe
  assert.equal(g.shortestPath('a', 'c').distance, 20);
  // Gabarit 2 m : l'arête étroite est exclue
  assert.equal(g.shortestPath('a', 'c', { minWidth: 2 }), null);
  assert.deepEqual([...g.reachableFrom('a', 2)].sort(), ['a', 'b']);
  // distancesFrom couvre tout le graphe accessible
  const dist = g.distancesFrom('a');
  assert.equal(dist.get('c'), 20);
});
