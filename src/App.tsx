import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { Skeleton } from './components/explorer/ui';
import OrganizationPage from './pages/OrganizationPage';

// Explorer routes are code-split: each page loads only when it is first visited.
const RepositoryPage = lazy(() => import('./pages/RepositoryPage'));
const TreePage = lazy(() => import('./pages/TreePage'));
const BlobPage = lazy(() => import('./pages/BlobPage'));
const CommitsPage = lazy(() => import('./pages/CommitsPage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function PageFallback() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6" aria-busy="true">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="mt-6 h-72 w-full" />
    </div>
  );
}

/** Route table for the whole site. Used by main.tsx and by the route tests. */
export default function App() {
  return (
    <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<OrganizationPage />} />
              <Route
                path="repos/:repo"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <RepositoryPage />
                  </Suspense>
                }
              />
              <Route
                path="repos/:repo/tree/:ref/*"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <TreePage />
                  </Suspense>
                }
              />
              <Route
                path="repos/:repo/blob/:ref/*"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <BlobPage />
                  </Suspense>
                }
              />
              <Route
                path="repos/:repo/commits/:ref"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <CommitsPage />
                  </Suspense>
                }
              />
              <Route
                path="about"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <AboutPage />
                  </Suspense>
                }
              />
              {/* Former landing-page URL: keep old links working. */}
              <Route path="projects" element={<Navigate to="/" replace />} />
              <Route
                path="*"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <NotFoundPage />
                  </Suspense>
                }
              />
            </Route>
          </Routes>
  );
}
