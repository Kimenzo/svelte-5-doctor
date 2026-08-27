<script lang="ts">
  import type { Snippet } from "svelte";
  import DOMPurify from "dompurify";

  interface Props {
    title: string;
    count?: number;
    children: Snippet;
    onIncrement?: () => void;
  }
  let { title, count = $bindable(0), children, onIncrement }: Props = $props();

  let doubled = $derived(count * 2);
  let sanitized = $derived(DOMPurify.sanitize(title));

  $effect(() => {
    const id = setInterval(() => console.log(doubled), 1000);
    return () => clearInterval(id);
  });
</script>

<div class="card">
  <h2>{title} — {doubled}</h2>
  <button onclick={onIncrement} onkeydown={(e) => e.key === "Enter" && onIncrement?.()}>increment</button>
  <div>{@html sanitized}</div>
  {@render children()}
</div>

{#each [1,2,3] as item (item)}
  <div>{item}</div>
{/each}

<style>
  .card { transform: translateZ(0); }
</style>
