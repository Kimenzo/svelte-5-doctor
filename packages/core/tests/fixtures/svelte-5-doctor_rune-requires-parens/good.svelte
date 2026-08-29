<script>
  // good fixture for svelte-5-doctor/rune-requires-parens
  // Valid: runes with parentheses
  let count = $state(0)
  let doubled = $derived(count * 2)
  let name = $state<string>("hello")

  // Valid: generic syntax — should NOT be mangled
  let typed = $state<number>(0)
  let derivedTyped = $derived<string>("x")
  let propsTyped = $props<{ title: string }>()

  // Valid: variables containing rune-like substrings
  let effectiveMode = true
  let stateful = $state(0)
  let derivedFrom = $derived(stateful * 2)
  let effectCleanup = $state(false)
</script>
<div>ok</div>
