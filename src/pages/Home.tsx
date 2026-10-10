import Hero from '../components/Hero';
import Stats from '../components/Stats';
import ProjectExplorer from '../components/ProjectExplorer';

export default function Home() {
  return (
    <div className="pt-24">
      <Hero />
      <Stats />
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-text mb-4">Our Projects</h2>
            <p className="text-text/60 max-w-2xl mx-auto">
              Browse through our collection of open-source repositories
            </p>
          </div>
        </div>
      </div>
      <ProjectExplorer />
    </div>
  );
}
