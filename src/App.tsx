import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import Layout from "./components/Layout";
import { Skeleton } from "./components/explorer/ui";
import OrganizationPage from "./pages/OrganizationPage";

const ExplorePage = lazy(() => import("./pages/ExplorePage"));
const RepositoriesPage = lazy(() => import("./pages/RepositoriesPage"));
const RepositoryPage = lazy(() => import("./pages/RepositoryPage"));
const TreePage = lazy(() => import("./pages/TreePage"));
const BlobPage = lazy(() => import("./pages/BlobPage"));
const CommitsPage = lazy(() => import("./pages/CommitsPage"));
const BranchesPage = lazy(() => import("./pages/BranchesPage"));
const IssuesPage = lazy(() => import("./pages/IssuesPage"));
const IssueDetailPage = lazy(() => import("./pages/IssueDetailPage"));
const PullRequestsPage = lazy(() => import("./pages/PullRequestsPage"));
const PullRequestDetailPage = lazy(
  () => import("./pages/PullRequestDetailPage"),
);
const AboutPage = lazy(() => import("./pages/AboutPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

function PageFallback() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6" aria-busy="true">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="mt-6 h-72 w-full" />
    </div>
  );
}

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

/** Route table for the whole site. Used by main.tsx and by route tests. */
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<OrganizationPage />} />
          <Route
            path="explore"
            element={
              <LazyPage>
                <ExplorePage />
              </LazyPage>
            }
          />
          <Route
            path="repos"
            element={
              <LazyPage>
                <RepositoriesPage />
              </LazyPage>
            }
          />
          <Route
            path="repos/:repo"
            element={
              <LazyPage>
                <RepositoryPage />
              </LazyPage>
            }
          />
          <Route
            path="repos/:repo/issues"
            element={
              <LazyPage>
                <IssuesPage />
              </LazyPage>
            }
          />
          <Route
            path="repos/:repo/issues/:number"
            element={
              <LazyPage>
                <IssueDetailPage />
              </LazyPage>
            }
          />
          <Route
            path="repos/:repo/pulls"
            element={
              <LazyPage>
                <PullRequestsPage />
              </LazyPage>
            }
          />
          <Route
            path="repos/:repo/pulls/:number"
            element={
              <LazyPage>
                <PullRequestDetailPage />
              </LazyPage>
            }
          />
          <Route
            path="repos/:repo/branches"
            element={
              <LazyPage>
                <BranchesPage />
              </LazyPage>
            }
          />
          <Route
            path="repos/:repo/tree/:ref/*"
            element={
              <LazyPage>
                <TreePage />
              </LazyPage>
            }
          />
          <Route
            path="repos/:repo/blob/:ref/*"
            element={
              <LazyPage>
                <BlobPage />
              </LazyPage>
            }
          />
          <Route
            path="repos/:repo/commits/:ref"
            element={
              <LazyPage>
                <CommitsPage />
              </LazyPage>
            }
          />
          <Route
            path="issues"
            element={
              <LazyPage>
                <IssuesPage />
              </LazyPage>
            }
          />
          <Route
            path="pulls"
            element={
              <LazyPage>
                <PullRequestsPage />
              </LazyPage>
            }
          />
          <Route
            path="about"
            element={
              <LazyPage>
                <AboutPage />
              </LazyPage>
            }
          />
          <Route path="projects" element={<Navigate to="/repos" replace />} />
          <Route
            path="*"
            element={
              <LazyPage>
                <NotFoundPage />
              </LazyPage>
            }
          />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
