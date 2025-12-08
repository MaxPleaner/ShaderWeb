import preprocess from "svelte-preprocess";
// import adapter from "@sveltejs/adapter-auto";

// /** @type {import('@sveltejs/kit').Config} */
// const config = {
//   kit: {
//     // adapter-auto only supports some environments, see https://kit.svelte.dev/docs/adapter-auto for a list.
//     // If your environment is not supported or you settled on a specific environment, switch out the adapter.
//     // See https://kit.svelte.dev/docs/adapters for more information about adapters.
//     adapter: adapter(),
//   },

  // preprocess: [
  //   preprocess({
  //     coffeescript: {
  //       bare: true,
  //     },
  //   }),
  // ],
// };

// export default config;

import adapter from '@sveltejs/adapter-static';

const dev = process.argv.includes('dev');

export default {
  kit: {
    adapter: adapter({
      // default options are shown. On some platforms
      // these options are set automatically — see below
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',
      strict: true
    }),
    paths: {
      base: dev ? '' : (process.env.BASE_PATH || '')
    }
  },
  preprocess: [
    preprocess({
      coffeescript: {
        bare: true,
      },
    }),
  ],
};
