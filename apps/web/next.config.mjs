/** @type {import('next').NextConfig} */
export default {
  // The workspace packages ship TypeScript source.
  transpilePackages: ['@quillquest/story', '@quillquest/sync'],
  reactStrictMode: false, // the editor and provider own sockets; strict mode's double mount would open two
};
