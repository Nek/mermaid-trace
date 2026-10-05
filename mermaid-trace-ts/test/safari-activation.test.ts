import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { createMermanProducer } from '../src/producer/merman.js';
import { watchPreview } from '../src/watch.js';
import { formatLocation } from '../src/markdown-source.js';

test('SAFARI: saved and live native selections retain gestures, source ownership and clipboard', {
  skip: process.env.TRACE_TEST_SAFARI !== '1', timeout: 600_000,
}, async t => {
  assert.equal(process.platform, 'darwin', 'Safari acceptance requires macOS and the installed Safari driver');
  const producer = await createMermanProducer();
  const directory = await mkdtemp(join(tmpdir(), 'trace-safari-'));
  const filename = join(directory, 'diagrams.md');
  let preview: Awaited<ReturnType<typeof watchPreview>> | undefined;
  const driver = spawn('/usr/bin/safaridriver', ['--mcp'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: driver.stdout });
  let sequence = 0;
  const request = (method: string, params: unknown): Promise<any> => new Promise((resolve, reject) => {
    const id = ++sequence;
    const cleanup = () => { clearTimeout(timer); lines.off('line', receive); driver.off('error', fail); driver.off('exit', exited); };
    const fail = (error: Error) => { cleanup(); reject(error); };
    const exited = () => fail(new Error('Safari driver exited during a request'));
    const receive = (line: string) => {
      try {
        const message = JSON.parse(line);
        if (message.id !== id) return;
        cleanup();
        if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
      } catch (error) { fail(error as Error); }
    };
    const timer = setTimeout(() => fail(new Error(`Safari request timed out: ${method}`)), 15_000);
    lines.on('line', receive); driver.once('error', fail); driver.once('exit', exited);
    driver.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const call = async (name: string, args: unknown) => {
    const result = await request('tools/call', { name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return result.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('\n') as string;
  };
  const evaluate = async (expression: string) => JSON.parse(await call('evaluate_javascript', { expression }));
  let tab: string | undefined;
  try {
    await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mermaid-trace-tests', version: '0' } });
    driver.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    tab = JSON.parse(await call('create_tab', { url: 'data:text/html,<title>Mermaid Trace Safari acceptance</title>' })).handle;
    const reader = 'data:text/javascript;base64,' + (await readFile('dist/src/svg-mapping.js')).toString('base64');
    const activation = 'data:text/javascript;base64,' + Buffer.from((await readFile('dist/src/svg-activation.js', 'utf8')).replace("'./svg-mapping.js'", JSON.stringify(reader))).toString('base64');
    const cases: [source: string, selection: string, role?: string, groupSize?: number][] = [
      ['flowchart LR\nA[Alpha] --> B[Beta]', 'Alpha'], ['flowchart-elk LR\nA[Alpha] --> B[Beta]', 'Alpha'],
      ['sequenceDiagram\nA->>B: Alpha', 'Alpha'],
      ['gantt\ndateFormat YYYY-MM-DD\nAlpha :a, 2026-10-01, 2d', 'Alpha'],
      ['journey\nsection Work\nAlpha: 5: Alice', 'Alpha'],
      ['kanban\n  todo[Todo]\n    task[Alpha]', 'Alpha'], ['stateDiagram-v2\nstate "Alpha" as A', 'Alpha'],
      ...['flowchart LR', 'flowchart-elk LR'].map((header): [string, string] => [`---\nconfig: {htmlLabels: true}\n---\n${header}\nA["$$Alpha$$"]`, '$$Alpha$$']),
      ...['A\u20dd A 😀', '🧑\u200d💻 123 ABC'].flatMap(unit => ['dagre', 'elk'].map((layout): [string, string] => {
        const label = Array(12).fill(unit).join(' ');
        return [`---\nconfig: ${JSON.stringify({ layout, htmlLabels: false, markdownAutoWrap: false, fontFamily: 'Arial' })}\n---\nflowchart LR\nA["\`${label}\`"]`, label];
      })),
    ];
    cases.push(...['dagre', 'elk'].flatMap(layout => [false, true].flatMap(htmlLabels => [false, true].map((safe): [string, string] => {
      const label = "<span style='color:red;/* --> */'>Alpha 😀</span>";
      return [`%% XML ${layout} ${htmlLabels} ${safe}\n%%{init: ${JSON.stringify({ layout, htmlLabels, dompurifyConfig: { SAFE_FOR_XML: safe } })}}%%\nflowchart LR\nA["${label}"] --> B[Beta]`, label];
    }))));
    cases.push(...['dagre', 'elk'].flatMap(layout => [false, true].map((markdown): [string, string] => {
      const label = '&gt;́x&amp;&lt;', authored = markdown ? '`' + label + '`' : label;
      return [`%% XML wrapping ${layout} ${markdown}\n%%{init: ${JSON.stringify({ layout, htmlLabels: false, flowchart: { wrappingWidth: 1 } })}}%%\nflowchart LR\nA["${authored}"] --> B[Beta]`, label];
    })));
    cases.push(...['dagre', 'elk'].flatMap(layout => [false, true].flatMap(htmlLabels => [false, true].map((allow): [string, string] => {
      const label = "<span id='item' name='tag' title='left/>right' style='color:red;/* /> */'>Alpha 😀</span>";
      return [`%% ATTRIBUTES ${layout} ${htmlLabels} ${allow}\n%%{init: ${JSON.stringify({ layout, htmlLabels, dompurifyConfig: { ALLOW_SELF_CLOSE_IN_ATTR: allow, SANITIZE_NAMED_PROPS: true } })}}%%\nflowchart LR\nA["${label}"] --> B[Beta]`, label];
    }))));
    cases.push(...['dagre', 'elk'].flatMap(layout => [false, true].flatMap(htmlLabels => {
      const label = 'Alpha 😀 ${secret}', edge = 'Next ${secret}', group = 'Group ${secret}';
      const source = `%% TEMPLATES ${layout} ${htmlLabels}\n%%{init: ${JSON.stringify({ layout, htmlLabels, dompurifyConfig: { SAFE_FOR_TEMPLATES: true } })}}%%\nflowchart LR\nsubgraph G["${group}"]\nA["${label}"] ab@-->|"${edge}"| B[Beta]\nend`;
      return [[source, label], [source, edge, 'edge-label'], [source, group, 'control-label']] as [string, string, string?][];
    })));
    cases.push(...['dagre', 'elk'].flatMap(layout => [false, true].flatMap(htmlLabels => ['FORBID_CONTENTS', 'ADD_FORBID_CONTENTS'].map((option): [string, string] => {
      const label = '<div>Hidden <b>nested</b></div>Alpha 😀';
      return [`%% SANITIZER ${layout} ${htmlLabels} ${option}\n%%{init: ${JSON.stringify({ layout, htmlLabels, dompurifyConfig: { FORBID_TAGS: ['div'], [option]: ['DIV'] } })}}%%\nflowchart LR\nA["${label}"] --> B[Beta]`, label];
    }))));
    cases.push(...cases.slice(0, 7).map(([source]): [string, string] => [
      `%% MAX-TEXT ${source.split('\n')[0]}\n%%{init: {maxTextSize: 0}}%%\n${source.replace('Alpha', 'Alpha 😀')}`, 'Alpha 😀',
    ]));
    cases.push(...['dagre', 'elk'].flatMap((layout): [string, string, string?][] => {
      const source = `%% MAX-EDGES ${layout}\n%%{init: ${JSON.stringify({ layout, maxEdges: 0 })}}%%\nflowchart LR\nA[Alpha] ab@-->|next| B[Beta]`;
      return [[source, 'Alpha'], [source, 'ab@-->|next|', 'edge'], [source, 'next', 'edge-label']];
    }));
    cases.push(...['default', 'legacy', 'modelOrder', 'depthFirst'].map((preset): [string, string] => [
      `%% ELK preset ${preset}\n%%{init: ${JSON.stringify({ layout: 'elk', elk: { preset } })}}%%\nflowchart LR\nsubgraph Outer\nsubgraph G[Group]\nA[Alpha] --> B[Beta]\nB --> C[Gamma]\nC --> A\nend\nend\nA --> D[Delta]\nB --> D`, 'Alpha',
    ]));
    cases.push(...['NETWORK_SIMPLEX', 'LONGEST_PATH', 'LONGEST_PATH_SOURCE', 'COFFMAN_GRAHAM', 'MIN_WIDTH', 'STRETCH_WIDTH', 'INTERACTIVE'].flatMap((layeringStrategy): [string, string, string?][] => {
      const source = `%% ELK layering ${layeringStrategy}\n%%{init: ${JSON.stringify({ layout: 'elk', elk: { layeringStrategy, layeringLayerBound: 1 } })}}%%\nflowchart LR\nsubgraph G[Group]\nA[Alpha] --> B[Beta]\nB --> C[Gamma]\nC --> A\nend\nA --> D[Delta]\nD f@-->|last| E[End]`;
      return [[source, 'Alpha'], [source, 'f@-->|last|', 'edge'], [source, 'last', 'edge-label']];
    }));
    cases.push(...[false, 'arc', 'gap'].flatMap((lineHops): [string, string, string?][] => {
      const source = `%% ELK hops ${lineHops}\n%%{init: ${JSON.stringify({ layout: 'elk', elk: { lineHops } })}}%%\nflowchart TB\nsubgraph G[Crossings]\nA[Alpha] --> D\nA --> E\nA e@-->|crossing| F\nB --> D\nB --> E\nB --> F\nC --> D\nC --> E\nC --> F\nend\ne@{curve: basis}`;
      return [[source, 'Alpha'], [source, 'e@-->|crossing|', 'edge'], [source, 'crossing', 'edge-label']];
    }));
    cases.push(...[false, true].flatMap((straightenEdges): [string, string, string?][] => {
      const source = `%% ELK straighten ${straightenEdges}\n%%{init: ${JSON.stringify({ layout: 'elk', elk: { straightenEdges, lineHops: false } })}}%%\nflowchart TB\nsubgraph G[Routes]\nA[Alpha] --> D\nA --> E\nA --> F\nB --> D\nB --> E\nB --> F\nC e@-->|route| D\nC --> E\nC --> F\nend`;
      return [[source, 'Alpha'], [source, 'e@-->|route|', 'edge'], [source, 'route', 'edge-label']];
    }));
    cases.push(...['NONE', 'NODES_AND_EDGES', 'PREFER_EDGES', 'PREFER_NODES'].flatMap(considerModelOrder => [false, true].flatMap((forceNodeModelOrder): [string, string, string?][] => {
      const source = `%% ELK ordering ${considerModelOrder}/force=${forceNodeModelOrder}\n%%{init: ${JSON.stringify({ layout: 'elk', elk: { preset: 'legacy', considerModelOrder, forceNodeModelOrder } })}}%%\nflowchart TB\nS[Start]\nA[Alpha]\nB[Beta]\nC[Gamma]\nS sc@-->|route| C\nS --> B\nS --> A`;
      return [[source, 'Alpha'], [source, 'sc@-->|route|', 'edge']];
    })));
    cases.push(...['GREEDY', 'DEPTH_FIRST', 'INTERACTIVE', 'MODEL_ORDER', 'GREEDY_MODEL_ORDER'].flatMap((cycleBreakingStrategy): [string, string, string?][] => {
      const source = `%% ELK ordering ${cycleBreakingStrategy}\n%%{init: ${JSON.stringify({ layout: 'elk', elk: { preset: 'legacy', cycleBreakingStrategy } })}}%%\nflowchart LR\nsubgraph G[Group]\nA[Alpha]\nB[Beta]\nC[Gamma]\nD[Delta]\nA ab@-->|route| B\nB --> C\nC --> A\nB --> D\nD --> A\nend`;
      return [[source, 'ab@-->|route|', 'edge'], [source, 'route', 'edge-label']];
    }));
    cases.push(...[false, true].flatMap(nested => [false, true].flatMap((keepEntryNodeOnTop): [string, string, string?][] => {
      const body = 'B[Beta]\nC[Gamma]\nA[Alpha]\nA ab@-->|next| B\nB --> C\nC --> A';
      const source = `%% ELK entry nested=${nested}/entry=${keepEntryNodeOnTop}\n%%{init: ${JSON.stringify({ layout: 'elk', elk: { preset: 'legacy', keepEntryNodeOnTop } })}}%%\nflowchart TB\n${nested ? `subgraph G[Group]\n${body}\nend` : body}`;
      return [[source, 'Alpha'], [source, 'ab@-->|next|', 'edge'], [source, 'next', 'edge-label']];
    })));
    cases.push(...['SIMPLE', 'NETWORK_SIMPLEX', 'LINEAR_SEGMENTS', 'BRANDES_KOEPF'].flatMap((nodePlacementStrategy): [string, string, string?][] => {
      const source = `%% ELK placement ${nodePlacementStrategy}\n%%{init: ${JSON.stringify({ layout: 'elk', elk: { preset: 'legacy', nodePlacementStrategy, mergeEdges: true, nodePlacementAlignment: nodePlacementStrategy === 'BRANDES_KOEPF' ? 'RIGHTDOWN' : 'BALANCED' } })}}%%\nflowchart TB\nsubgraph G[Group]\nA[Alpha] ab@-->|next| B[Longer beta]\nA ac@--> C[Gamma]\nA ad@--> D[Delta]\nB --> E[End]\nC --> E\nD --> E\nA ae@--> E\nend`;
      return [[source, 'Alpha'], [source, 'ab@-->|next|', 'edge'], [source, 'ac@-->', 'edge'], [source, 'next', 'edge-label']];
    }));
    cases.push(
      ...['flowchart LR', 'flowchart-elk LR'].flatMap((header): [string, string, string?, number?][] => [
        [`${header}\nA[Alpha] --> B[Beta]`, 'A[Alpha]', 'node'],
        [`${header}\nA[Alpha] --> B[Beta]`, '-->', 'edge'],
      ]),
      ['sequenceDiagram\nA->>B: Alpha', 'A', 'node', 4],
      ['sequenceDiagram\nA->>B: Alpha', 'A->>B: Alpha', 'edge'],
      ['gantt\ndateFormat YYYY-MM-DD\nAlpha :a, 2026-10-01, 2d', 'Alpha :a, 2026-10-01, 2d', 'node'],
      ['journey\nsection Work\nAlpha: 5: Alice', 'Alpha: 5: Alice', 'node'],
      ['journey\nsection Work\nAlpha: 5: Alice', 'Alice', 'control', 3],
      ['kanban\n  todo[Todo]\n    task[Alpha]', 'task[Alpha]', 'node'],
      ['stateDiagram-v2\nstate "Alpha" as A\nA --> B : next', 'state "Alpha" as A', 'node'],
      ['stateDiagram-v2\nstate "Alpha" as A\nA --> B : next', 'A --> B : next', 'edge'],
      ...['control', 'edge'].map((role): [string, string, string?, number?] => [
        'stateDiagram-v2\nstate "Published" as Published\nnote right of Published : Available to readers',
        'note right of Published : Available to readers', role, 2,
      ]),
    );
    // Body and stroke hit areas have no separate text-tree UID; clicking the control's
    // centre can instead activate its independently editable label.
    const pointer = async (aria: string, role: string | undefined, last = false) => {
      const content = JSON.parse(await call('get_page_content', { format: 'textTree', nodeIds: 'allContainers', region: 'entire_page' })).content as string;
      const rows = content.split('\n').filter(line => line.includes(`label='${aria}'`));
      const uid = rows.at(last ? -1 : 0)?.match(/uid=(\d+)/)?.[1];
      assert.ok(uid, `Safari must expose the mapped selection: ${content}`);
      if (!role) return { node: uid, scrollToVisible: true };
      const point = await evaluate(`window.label.scrollIntoView({block:'center'});
        const element=window.label, box=element.getBoundingClientRect();
        const points=[];
        if(element.matches('path,line')){
          for(let f=.05;f<1;f+=.05)points.push(element.getPointAtLength(element.getTotalLength()*f).matrixTransform(element.getScreenCTM()));
        }else for(const x of [.1,.3,.5,.7,.9])for(const y of [.1,.5,.9])points.push({x:box.x+box.width*x,y:box.y+box.height*y});
        for(const p of points){
          const point={x:Math.round(p.x),y:Math.round(p.y)}, hit=document.elementFromPoint(point.x,point.y);
          if(hit?.closest('[data-mt-role]')===element || (hit===element.previousElementSibling && hit?.getAttribute('aria-hidden')==='true'))return point;
        }
        throw Error('Mapped body or stroke has no exposed pointer target');`);
      return { point };
    };
    for (const [source, label, role, groupSize = 1] of cases) await t.test(source.includes('markdownAutoWrap') ? 'shaping ' + source.split('\n')[1]! : source.includes('$$') ? source.split('\n')[3]! + ' formula' : source.split('\n')[0]! + (role ? ` ${role}: ${label}` : ''), async () => {
      const { svg } = await producer.render('safari-native', source);
      const span = { start: source.indexOf(label), end: source.indexOf(label) + label.length };
      const aria = await evaluate(`return (async()=>{
        document.body.innerHTML=${JSON.stringify(svg + svg)};
        await document.fonts.ready;
        const {activateSvg}=await import(${JSON.stringify(activation)});
        window.events=[]; window.trusted=[];
        document.onclick=e=>window.trusted.push({type:e.type,trusted:e.isTrusted});
        document.onkeydown=e=>window.trusted.push({type:e.type,key:e.key,trusted:e.isTrusted});
        window.roots=[...document.querySelectorAll('svg[data-mt-map]')];
        window.originals=window.roots.map(root=>root.outerHTML);
        window.handles=window.roots.map(root=>activateSvg(root,{onSelect:event=>window.events.push(event)}));
        window.label=window.roots[0].querySelector('${role ? `[data-mt-role=${role}]` : ''}[data-mt-start="${span.start}"][data-mt-end="${span.end}"]');
        window.group=[...window.label.closest('svg[data-mt-map]').querySelectorAll('[data-mt-start="'+window.label.dataset.mtStart+'"][data-mt-end="'+window.label.dataset.mtEnd+'"]')];
        return window.label.getAttribute('aria-label');
      })();`);
      if (source.includes('markdownAutoWrap')) {
        const geometry = await evaluate(`const box=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
          return {label:box(window.label),shape:box(window.roots[0].querySelector('[data-mt-role=node] > rect')),scale:window.roots[0].getScreenCTM().a,text:window.label.textContent};`);
        assert.equal(geometry.text, label);
        for (const side of ['left', 'top']) assert.ok(geometry.label[side] >= geometry.shape[side] - 3 * geometry.scale, JSON.stringify(geometry));
        for (const side of ['right', 'bottom']) assert.ok(geometry.label[side] <= geometry.shape[side] + 3 * geometry.scale, JSON.stringify(geometry));
      }
      let activations = 0;
      for (const interaction of [
        { type: 'click', ...await pointer(aria, role), purpose: 'Select the native diagram visual' },
        { type: 'keyPress', value: 'Enter', purpose: 'Activate the selected object with Enter' },
        { type: 'keyPress', value: ' ', purpose: 'Activate the selected object with Space' },
      ]) {
        await call('page_interactions', { interactions: [interaction] });
        const selected = await evaluate('return {span:window.events.at(-1).span,trigger:window.events.at(-1).trigger,count:window.events.filter(event=>event.trigger==="activation").length,trusted:window.trusted.at(-1),other:window.roots[1].querySelectorAll("[data-mt-selected]").length,group:window.group.length,selected:window.group.every(e=>e.dataset.mtSelected==="true"),stops:window.group.filter(e=>e.tabIndex===0).length,focused:window.group.includes(document.activeElement),outline:getComputedStyle(document.activeElement).outlineStyle,kinds:window.events.at(-1).pieces.map(p=>p.kind)};');
        assert.deepEqual(selected.span, span);
        assert.equal(selected.trigger, 'activation');
        assert.equal(selected.count, ++activations, `each gesture must produce a new activation: ${JSON.stringify(selected)}`);
        assert.equal(selected.trusted.trusted, true);
        assert.equal(selected.trusted.type, interaction.type === 'click' ? 'click' : 'keydown');
        if (interaction.type === 'keyPress') assert.equal(selected.trusted.key, interaction.value);
        assert.equal(selected.other, 0);
        assert.equal(selected.group, groupSize); assert.equal(selected.selected, true);
        assert.equal(selected.stops, 1); assert.equal(selected.focused, true); assert.equal(selected.outline, 'none');
        if (label.startsWith('note right of')) {
          assert.ok(selected.kinds.includes('control')); assert.ok(selected.kinds.includes('edge'));
        }
      }
      assert.equal(await evaluate(`window.handles[0].highlight([{start:${role ? span.start : span.start + 1},end:${role ? span.end : span.start + 2}}]);return window.group.every(e=>e.dataset.mtSelected==='true');`), true);
      assert.equal(await evaluate('window.handles.forEach(handle=>handle.dispose());return window.roots.every((root,i)=>root.outerHTML===window.originals[i]);'), true);
    });
    await call('set_viewport_size', { width: 1280, height: 900 });
    for (const [source, label, role, groupSize = 1] of cases) await t.test((source.startsWith('%% ') ? source.split('\n')[0]! + ' ' : '') + 'live ' + source.split('\n').find(line => /^(flowchart|sequenceDiagram|gantt|journey|kanban|stateDiagram)/.test(line))! + (source.includes('markdownAutoWrap') ? ' shaping ' + source.split('\n')[1]! : source.includes('$$') ? ' formula' : role ? ` ${role}: ${label}` : ''), async () => {
      const fence = '\n\n```mermaid\n' + source + '\n```\n';
      const markdown = '# Safari preview\n\n' + Array.from({ length: 35 }, (_, i) => `Paragraph ${i}.`).join('\n\n') + fence + fence;
      await writeFile(filename, markdown);
      preview = await watchPreview(filename, { port: 0, sourceView: true });
      try {
        await call('navigate_to_url', { tab_uuid: tab, url: preview.url });
        const aria = await evaluate(`return (async()=>{
          for(let i=0;i<200 && document.body.dataset.ready!=='true';i++)await new Promise(r=>setTimeout(r,25));
          if(document.body.dataset.ready!=='true')throw Error('Preview did not become ready');
          await document.fonts.ready;
          window.roots=[...document.querySelectorAll('svg[data-mt-map]')];
          window.label=window.roots[1].querySelector('${role ? `[data-mt-role=${role}]` : ''}[data-mt-start="${source.indexOf(label)}"][data-mt-end="${source.indexOf(label) + label.length}"]');
          window.group=[...window.roots[1].querySelectorAll('[data-mt-start="'+window.label.dataset.mtStart+'"][data-mt-end="'+window.label.dataset.mtEnd+'"]')];
          window.trusted=[];
          document.addEventListener('click',e=>window.trusted.push({type:e.type,trusted:e.isTrusted}));
          document.addEventListener('keydown',e=>window.trusted.push({type:e.type,key:e.key,trusted:e.isTrusted}));
          return window.label.getAttribute('aria-label');
        })();`);
        const start = markdown.lastIndexOf(source) + source.indexOf(label);
        const span = { start, end: start + label.length };
        const sentinel = 'Mermaid Trace clipboard unchanged';
        execFileSync('/usr/bin/pbcopy', { input: sentinel });
        await evaluate('window.label.focus(); return true;');
        assert.equal(execFileSync('/usr/bin/pbpaste', { encoding: 'utf8' }), sentinel, 'focus must not copy');
        for (const interaction of [
          { type: 'click', ...await pointer(aria, role, true), purpose: 'Select the second diagram visual after scrolling' },
          { type: 'keyPress', value: 'Enter', purpose: 'Copy the selected object location with Enter' },
          { type: 'keyPress', value: ' ', purpose: 'Copy the selected object location with Space' },
        ]) {
          execFileSync('/usr/bin/pbcopy', { input: sentinel });
          await call('page_interactions', { interactions: [interaction] });
          const result = await evaluate(`const doc=document.querySelector('#source-frame').contentDocument;
            const range=doc.getSelection().getRangeAt(0);
            return {start:range.startOffset,end:range.endOffset,text:range.cloneContents().textContent,
              scroll:doc.querySelector('#source').scrollTop,focused:window.group.includes(document.activeElement),
              group:window.group.length,selected:window.group.every(e=>e.dataset.mtSelected==='true'),stops:window.group.filter(e=>e.tabIndex===0).length,outline:getComputedStyle(document.activeElement).outlineStyle,
              trusted:window.trusted.at(-1),other:window.roots[0].querySelectorAll('[data-mt-selected]').length};`);
          assert.deepEqual({ start: result.start, end: result.end }, span);
          assert.equal(result.text, label); assert.ok(result.scroll > 0, 'source selection must scroll into view');
          assert.equal(result.focused, true); assert.equal(result.other, 0);
          assert.equal(result.group, groupSize); assert.equal(result.selected, true); assert.equal(result.stops, 1); assert.equal(result.outline, 'none');
          assert.equal(result.trusted.trusted, true);
          assert.equal(result.trusted.type, interaction.type === 'click' ? 'click' : 'keydown');
          if (interaction.type === 'keyPress') assert.equal(result.trusted.key, interaction.value);
          assert.equal(execFileSync('/usr/bin/pbpaste', { encoding: 'utf8' }), formatLocation({ id: filename, source: markdown }, span));
        }
        execFileSync('/usr/bin/pbcopy', { input: sentinel });
        const firstStart = markdown.indexOf(source) + source.indexOf(label);
        assert.equal(await evaluate(`return (async()=>{
          const doc=document.querySelector('#source-frame').contentDocument, range=doc.createRange();
          range.setStart(doc.querySelector('#source').firstChild,${firstStart});range.setEnd(doc.querySelector('#source').firstChild,${firstStart + label.length});
          doc.getSelection().removeAllRanges();doc.getSelection().addRange(range);
          for(let i=0;i<100 && window.roots[0].querySelector('[data-mt-selected]')===null;i++)await new Promise(r=>setTimeout(r,25));
          const group=[...window.roots[0].querySelectorAll('[data-mt-start="${source.indexOf(label)}"][data-mt-end="${source.indexOf(label) + label.length}"]')];
          return group.length===${groupSize} && group.every(e=>e.dataset.mtSelected==='true');
        })();`), true);
        assert.equal(await evaluate("return window.roots[1].querySelectorAll('[data-mt-selected]').length;"), 0);
        assert.equal(execFileSync('/usr/bin/pbpaste', { encoding: 'utf8' }), sentinel, 'reverse selection must not copy');
      } finally { await preview.close(); preview = undefined; }
    });
    await t.test('FONT-CSS-SAFARI: embedded mixed-font labels preserve selectors and size edits', async () => {
      const source = '---\nconfig:\n  fontFamily: Arial\n---\nstateDiagram-v2\nstate "Alpha 😀 中文" as A';
      const { svg } = await producer.render('font-css', source);
      await call('navigate_to_url', { tab_uuid: tab, url: 'data:text/html,<title>Mermaid Trace font CSS</title>' });
      const result = await evaluate(`return (async()=>{
        document.body.innerHTML=${JSON.stringify(svg)};
        await document.fonts.ready;
        const label=[...document.querySelectorAll('.text-inner-tspan')].find(e=>e.textContent==='Alpha 😀 中文');
        const before={fill:getComputedStyle(label).fill,text:label.textContent,children:label.children.length};
        const style=document.createElement('style');document.head.append(style);
        const sizes=[];
        for(const size of [22,11]){
          style.textContent='.text-inner-tspan:has(> tspan){fill:red!important}.text-inner-tspan{font-size:'+size+'px!important}';
          await document.fonts.ready;
          sizes.push({fill:getComputedStyle(label).fill,text:label.textContent,size:getComputedStyle(label).fontSize,width:label.getComputedTextLength()});
        }
        return {before,sizes};
      })();`);
      assert.equal(result.before.children, 0, 'font transport must preserve the text-only owner');
      for (const [index, size] of [22, 11].entries()) {
        assert.equal(result.sizes[index].fill, result.before.fill);
        assert.equal(result.sizes[index].text, result.before.text);
        assert.equal(result.sizes[index].size, `${size}px`);
        assert.ok(result.sizes[index].width > 0, 'resizing must not hide the label');
      }
      assert.ok(Math.abs(result.sizes[0].width / 2 - result.sizes[1].width) < 0.1,
        'mixed-font text must scale with authored CSS size');
    });
    await t.test('WATCH-SAFARI: saves, invalid edits and atomic replacement preserve current mappings', async () => {
      const sources = cases.slice(0, 7).map(([source]) => source);
      const markdown = '# Watch 🐟\r\n\r\n' + sources.map(source => '```mermaid\r\n' + source.replaceAll('\n', '\r\n') + '\r\n```\r\n').join('\r\n');
      const errors: string[] = [];
      await writeFile(filename, markdown);
      preview = await watchPreview(filename, { port: 0, sourceView: true, onError: error => errors.push(String(error)) });
      const waitForSource = async (expected: string) => {
        for (let i = 0; i < 100; i++) {
          if (await evaluate(`return document.body.dataset.ready==='true' && document.querySelector('#source-frame')?.contentDocument?.querySelector('#source')?.textContent===${JSON.stringify(expected)};`)) return;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.fail('Safari must reload both rendered and original source views after the file save');
      };
      const selectLabels = async (documentSource: string, label: string) => {
        for (const [index, source] of sources.entries()) {
          const logical = source.replaceAll('Alpha', label);
          const local = logical.indexOf(label);
          const aria = await evaluate(`return (async()=>{
            await document.fonts.ready;
            window.roots=[...document.querySelectorAll('svg[data-mt-map]')];
            window.label=window.roots[${index}].querySelector('[data-mt-start="${local}"][data-mt-end="${local + label.length}"]');
            window.trusted=[];document.onclick=e=>window.trusted.push(e.isTrusted);
            return window.label.getAttribute('aria-label');
          })();`);
          // Repeated label names have different native IDs; click the actual label surface.
          execFileSync('/usr/bin/pbcopy', { input: 'No automatic copy after reload' });
          await call('page_interactions', { interactions: [{ type: 'click', ...await pointer(aria, 'label'), purpose: 'Select the current label after a real file update' }] });
          const start = documentSource.indexOf(logical.replaceAll('\n', '\r\n')) + logical.slice(0, local).replaceAll('\n', '\r\n').length;
          const span = { start, end: start + label.length };
          assert.deepEqual(await evaluate(`const selection=document.querySelector('#source-frame').contentDocument.getSelection(),range=selection.getRangeAt(0);
            return {start:range.startOffset,end:range.endOffset,text:range.cloneContents().textContent,trusted:window.trusted.at(-1),selected:window.label.dataset.mtSelected,other:window.roots.filter((_,i)=>i!==${index}).some(root=>root.querySelector('[data-mt-selected]'))};`),
          { ...span, text: label, trusted: true, selected: 'true', other: false });
          assert.equal(execFileSync('/usr/bin/pbpaste', { encoding: 'utf8' }), formatLocation({ id: filename, source: documentSource }, span));
        }
      };
      try {
        await call('navigate_to_url', { tab_uuid: tab, url: preview.url });
        await waitForSource(markdown);
        await selectLabels(markdown, 'Alpha');
        await evaluate('window.watchMarker=true;return true;');
        await writeFile(filename, markdown);
        await new Promise(resolve => setTimeout(resolve, 750));
        assert.equal(await evaluate("return window.watchMarker===true && window.label.dataset.mtSelected==='true';"), true, 'unchanged content must preserve the page and its selection');
        const changed = markdown.replaceAll('Alpha', 'Updated 🐟');
        await writeFile(filename, changed);
        await waitForSource(changed);
        assert.equal(await evaluate('return window.watchMarker===undefined;'), true, 'the changed file must really reload');
        await selectLabels(changed, 'Updated 🐟');
        await evaluate('window.watchMarker=true;return true;');
        await writeFile(filename, '# Broken\n\n```mermaid\nflowchart LR\nA -->\n```');
        for (let i = 0; i < 100 && !errors.length; i++) await new Promise(resolve => setTimeout(resolve, 100));
        assert.ok(errors.some(error => /parse|syntax/i.test(error)), 'invalid syntax must report a diagnostic');
        assert.equal(await evaluate(`return window.watchMarker===true && document.querySelector('#source-frame').contentDocument.querySelector('#source').textContent===${JSON.stringify(changed)} && window.label.dataset.mtSelected==='true' && !document.querySelector('vite-error-overlay');`), true, 'invalid edits retain the interactive last good page');
        const recovered = changed.replaceAll('Updated 🐟', 'Recovered 🐟');
        const replacement = join(directory, 'replacement.md');
        await writeFile(replacement, recovered); await rename(replacement, filename);
        await waitForSource(recovered);
        await selectLabels(recovered, 'Recovered 🐟');
      } finally { await preview.close(); preview = undefined; }
    });

  } finally {
    try { if (tab) await call('close_tab', { handle: tab }); }
    finally { lines.close(); driver.kill(); await preview?.close(); await producer.close(); await rm(directory, { recursive: true, force: true }); }
  }
});
