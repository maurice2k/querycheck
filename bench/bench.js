'use strict';

// Compares this version with an older one (default: bench/.querycheck-1.x.js,
// written by `make bench` from the 1.1.2 tag).
//
//   node bench/bench.js [path/to/old/querycheck.js]

const path = require('path');
const fs = require('fs');

const QueryCheck = require('../src/querycheck');
const oldPath = path.resolve(process.argv[2] || path.join(__dirname, '.querycheck-1.x.js'));
const OldQueryCheck = fs.existsSync(oldPath) ? require(oldPath) : null;

const doc = {
    age: 30,
    name: 'John',
    role: 'admin',
    tags: ['a', 'b', 'c'],
    now: { isoDate: '2020-05-21', isoTime: '13:59:48' },
    spent: 450,
    budget: 400,
    email: 'john.doe@example.com',
};

const fifty = {};
for (let i = 0; i < 50; i++) {
    doc[`f${i}`] = i;
    fifty[`f${i}`] = { $gte: i };
}

const cases = {
    '1 condition': { age: { $gte: 18 } },
    'Medium (4 fields, $in, $or)': {
        age: { $gt: 18, $lt: 65 },
        role: { $in: ['admin', 'owner'] },
        'now.isoTime': { $gt: '10:00' },
        $or: [{ name: 'John' }, { name: 'Jane' }],
    },
    'Strings + $regex': {
        name: { $regex: '^jo', $options: 'i' },
        email: { $regex: '@example\\.com$' },
        role: { $ne: 'banned' },
    },
    '$expr': { $expr: { $gt: [{ $add: ['$spent', 10] }, '$budget'] } },
    '50 conditions': fifty,
};

/**
 * @param {() => void} fn
 * @param {number} ms
 * @returns {number} ns per call
 */
function measure(fn, ms = 300) {
    for (let i = 0; i < 1000; i++) {
        fn();
    }
    let calls = 0;
    const start = process.hrtime.bigint();
    const end = start + BigInt(ms) * 1000000n;
    let now = start;
    while (now < end) {
        for (let i = 0; i < 1000; i++) {
            fn();
        }
        calls += 1000;
        now = process.hrtime.bigint();
    }
    return Number(now - start) / calls;
}

/**
 * @param {any} Impl
 * @param {object} query
 * @returns {{first: number, later: number}|null}
 */
function run(Impl, query) {
    try {
        new Impl(query).test(doc);
    } catch {
        return null; // not supported by this version
    }
    const first = measure(() => new Impl(query).test(doc));
    const qc = new Impl(query);
    const later = measure(() => qc.test(doc));
    return { first, later };
}

/**
 * @param {number} ns
 * @returns {string}
 */
function format(ns) {
    return ns >= 1000 ? `${(ns / 1000).toFixed(2)} µs` : `${ns.toFixed(0)} ns`;
}

console.log(`Node ${process.version}${OldQueryCheck ? `, compared with ${path.relative(process.cwd(), oldPath)}` : ''}\n`);

const rows = [['Query', 'First test() incl. build', 'Each later test()']];
for (const [name, query] of Object.entries(cases)) {
    const current = run(QueryCheck, query);
    const old = OldQueryCheck ? run(OldQueryCheck, query) : null;
    if (current === null) {
        throw new Error(`${name}: query failed`);
    }
    const cell = (/** @type {'first'|'later'} */ key) => {
        const value = format(current[key]);
        if (old === null) {
            return OldQueryCheck ? `${value} (old: unsupported)` : value;
        }
        const factor = old[key] / current[key];
        return `${value} (${factor >= 1 ? `${factor.toFixed(1)}× faster` : `${(1 / factor).toFixed(1)}× slower`})`;
    };
    rows.push([name, cell('first'), cell('later')]);
}

const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
for (const [i, row] of rows.entries()) {
    console.log(row.map((c, j) => c.padEnd(widths[j])).join('  '));
    if (i === 0) {
        console.log(widths.map((w) => '-'.repeat(w)).join('  '));
    }
}
