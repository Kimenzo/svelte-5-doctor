// Shared state module — triggers SSR leak detection
// svelte-doctor/state-invalid-export when reassigned export

export let count = $state(0); // svelte-doctor/state-invalid-export
count += 1; // reassignment after export

// Correct pattern (for reference):
// let _count = $state(0);
// export const getCount = () => _count;
// export const inc = () => _count++;
