import Head from 'next/head';

export default function Custom500() {
  return (
    <>
      <Head>
        <title>Server error</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>500 - Server error</h1>
          <p>Something went wrong. Please try again later.</p>
        </div>
      </main>
    </>
  );
}
