<script lang="ts">
  // --- Correctness: legacy syntax in runes mode (should be $props) ---
  export let title: string; // svelte-5-doctor/legacy-export-let

  // $: legacy reactive (invalid in runes)
  let count = 0; // svelte-5-doctor/non-reactive-update — not $state but mutated
  $: doubled = count * 2; // svelte-5-doctor/legacy-dollars-colon

  import * as _ from "lodash"; // svelte-5-doctor/no-barrel-import
  let raw = $state({ huge: { a: 1, b: 2, c: Array.from({length: 200}, (_,i)=>i) } } as unknown as Record<string, unknown>); // svelte-5-doctor/perf-avoid-deep-proxy (large)
  let list = $state([1,2,3]);

  // Effect deriving state (should be $derived)
  let derivedBad = $state(0);
  $effect(() => { derivedBad = count * 2; }); // svelte-5-doctor/no-effect-derived

  // Effect without cleanup
  $effect(() => {
    const id = setInterval(() => count++, 1000); // svelte-5-doctor/effect-needs-cleanup
  });

  // Mutating inside derived
  let badDerived = $derived.by(() => {
    let t = 0;
    count++; // svelte-5-doctor/no-mutate-in-derived
    return t;
  });

  // setContext snapshot bug
  import { setContext } from "svelte";
  setContext("count", count); // svelte-5-doctor/state-referenced-locally

  // Secrets — fake value to trigger svelte-5-doctor/no-secrets-in-client-code (not a real Stripe key)
  const apiKey = "FAKE_API_KEY_EXAMPLE_1234567890_NOT_REAL"; // svelte-5-doctor/no-secrets-in-client-code

  // eval
  eval("console.log(1)"); // svelte-5-doctor/no-eval

  // JS perf: filter.map, regexp in loop — keep inside same script (Svelte allows only one top-level script)
  const filtered = [1,2,3].filter(x=>x>1).map(x=>x*2); // svelte-5-doctor/js-combine-iterations
  for (let i=0;i<10;i++) { const re = new RegExp("a"); } // svelte-5-doctor/js-hoist-regexp
</script>

<!-- Security: unsanitized @html -->
<div>{@html title}</div> <!-- svelte-5-doctor/no-at-html-xss -->

<!-- a11y: missing alt, click without key -->
<img src="x.jpg" /> <!-- svelte-5-doctor/a11y-missing-attribute -->
<div onclick={() => count++}>click me</div> <!-- svelte-5-doctor/a11y-click-events-have-key-events -->

<!-- Performance: unkeyed each, index as key, each item mutation -->
{#each list as item}
  <div>{item}</div> <!-- svelte-5-doctor/no-index-as-key -->
{/each}

{#each list as entry}
  <input bind:value={entry} /> <!-- svelte-5-doctor/each-item-mutation -->
{/each}

<!-- Legacy slot + snippet conflict -->
<slot name="header" /> <!-- svelte-5-doctor/legacy-slot -->
{#snippet header()}Hello{/snippet} <!-- svelte-5-doctor/slot-snippet-conflict -->
{@render header()}

<!-- Legacy event directive + mixed syntax -->
<button on:click={() => count++}>old</button> <!-- svelte-5-doctor/legacy-event-directive + mixed-event-syntax -->
<button onclick={() => count++}>new</button>

<!-- Nested snippet -->
{#if count > 0}
  {#snippet nested()}bad{/snippet} <!-- svelte-5-doctor/no-nested-snippet -->
{/if}

<!-- Performance: layout animation, transition:all, large blur -->
<div style="transition:all 0.3s; width: {count}px; filter: blur(30px)"></div> <!-- svelte-5-doctor/no-transition-all, no-layout-animation, no-large-animated-blur -->

<!-- iframe without sandbox -->
<iframe src="https://example.com"></iframe> <!-- svelte-5-doctor/iframe-missing-sandbox -->

<!-- Giant component trigger: repeat lines to exceed 400 -->
<!-- (add 400 dummy lines via script) -->
