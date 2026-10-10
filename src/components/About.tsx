import { motion } from 'framer-motion';

export default function About() {
  return (
    <section className="py-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="text-4xl font-bold text-text mb-4">About AnkWorks</h2>
          <p className="text-lg text-text/70">
            Independent software development organization
          </p>
        </motion.div>

        <div className="space-y-12">
          {/* Mission */}
          <motion.div
            className="glass-card p-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <h3 className="text-2xl font-bold text-text mb-4">Mission</h3>
            <p className="text-text/80 leading-relaxed">
              AnkWorks is an independent software development organization focused on 
              building open-source tools, developer utilities, and experimental software 
              projects. We believe in creating practical, well-engineered solutions that 
              empower developers and users alike.
            </p>
          </motion.div>

          {/* Focus Areas */}
          <motion.div
            className="glass-card p-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <h3 className="text-2xl font-bold text-text mb-6">Focus Areas</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                {
                  title: 'Open-Source Development',
                  description: 'Building and maintaining open-source projects that anyone can use, contribute to, and learn from.',
                  icon: (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                      />
                    </svg>
                  ),
                },
                {
                  title: 'Developer Tools',
                  description: 'Creating utilities and tools that help developers be more productive and efficient.',
                  icon: (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                  ),
                },
                {
                  title: 'Web Technologies',
                  description: 'Working with modern web technologies to build fast, accessible, and beautiful web applications.',
                  icon: (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9V3m0 18a9 9 0 009-9M3 12a9 9 0 019-9"
                      />
                    </svg>
                  ),
                },
                {
                  title: 'Experimental Software',
                  description: 'Exploring new ideas and pushing boundaries with experimental software projects.',
                  icon: (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      />
                    </svg>
                  ),
                },
                {
                  title: 'Browser Technology',
                  description: 'Working on browser-related projects and web standards to improve the web platform.',
                  icon: (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 2C6.477 2 2 6.477 2 12c0 2.215.896 4.213 2.344 5.658.27.287.588.424.95.418.084-.01.215-.064.333-.237 1.079-.868 2.42-1.566 3.89-1.935.594-.153.882-.496.882-.92 0-.51-.321-1.034-.832-1.342A9.002 9.002 0 0012 18c2.21 0 4.208-.896 5.658-2.344.287-.27.424-.588.418-.95-.01-.084-.064-.215-.237-.333-.868-1.079-1.566-2.42-1.935-3.89-.153-.594-.496-.882-.92-.882-.51 0-1.034.321-1.342.832A9.002 9.002 0 0012 6c0-5.523 4.477-10 10-10z"
                      />
                    </svg>
                  ),
                },
                {
                  title: 'Practical Engineering',
                  description: 'Applying engineering best practices to create reliable, maintainable, and efficient software.',
                  icon: (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                      />
                    </svg>
                  ),
                },
              ].map((item, index) => (
                <motion.div
                  key={item.title}
                  className="p-4 rounded-lg hover:bg-surface/30 transition-colors duration-200"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.3 + index * 0.1 }}
                >
                  <div className="flex items-start space-x-3">
                    <div className="flex-shrink-0 text-primary/80">
                      {item.icon}
                    </div>
                    <div>
                      <h4 className="font-semibold text-text mb-1">{item.title}</h4>
                      <p className="text-sm text-text/60">{item.description}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Philosophy */}
          <motion.div
            className="glass-card p-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
          >
            <h3 className="text-2xl font-bold text-text mb-4">Philosophy</h3>
            <p className="text-text/80 leading-relaxed mb-4">
              We believe that great software comes from a combination of technical excellence, 
              user empathy, and a commitment to continuous improvement. Our projects are 
              designed to solve real problems, and we are always looking for ways to make 
              technology more accessible and useful.
            </p>
            <p className="text-text/80 leading-relaxed">
              As an independent organization, we have the freedom to explore ideas that 
              might not fit into traditional commercial models. This allows us to experiment 
              with new approaches, learn from failures, and share our knowledge with the 
              broader community.
            </p>
          </motion.div>

          {/* Call to Action */}
          <motion.div
            className="text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}
          >
            <p className="text-text/60 mb-6">
              Interested in our work? Check out our projects on GitHub and feel free to 
              contribute or provide feedback.
            </p>
            <a
              href="https://github.com/ankworks"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary inline-flex items-center justify-center space-x-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path
                  fillRule="evenodd"
                  d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.168 6.839 9.49.5.092.682-.217.682-.482 0-.237-.009-.868-.014-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.031-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.03 1.595 1.03 2.688 0 3.848-2.338 4.695-4.566 4.942.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.001 10.001 0 0022 12c0-5.523-4.477-10-10-10z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Explore on GitHub</span>
            </a>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
