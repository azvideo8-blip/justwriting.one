# Ethereal Ink / Stream of Consciousness

Ethereal Ink is a writing application designed to help you enter a flow state, capture your stream of consciousness, and track your writing progress.

## Philosophy
Writing is not just about the final product; it's about the process. Ethereal Ink provides a distraction-free environment to help you focus on your thoughts, whether you're journaling, drafting, or just letting your mind wander.

### Key Features
- **Ethereal Ink**: A distraction-free writing mode that fades out previous text, encouraging you to keep moving forward without over-editing.
- **Stream of Consciousness**: An AI-powered feature that analyzes your writing flow and provides real-time, non-intrusive suggestions or prompts to keep you unstuck.
- **Feature-First Architecture**: The codebase is organized by domain (e.g., `src/features/writing`, `src/features/profile`), making it highly modular and easy to navigate.

## Local Setup

### Prerequisites
- Node.js (v20+)
- npm

### Installation
1. Clone the repository.
2. Run `npm install` to install dependencies.
3. Create a `.env.local` file in the root directory and add the following:
   ```env
   GEMINI_API_KEY=your_gemini_api_key
   VITE_FIREBASE_API_KEY=your_firebase_api_key
   VITE_FIREBASE_AUTH_DOMAIN=your_firebase_auth_domain
   VITE_FIREBASE_PROJECT_ID=your_firebase_project_id
   VITE_FIREBASE_STORAGE_BUCKET=your_firebase_storage_bucket
   VITE_FIREBASE_MESSAGING_SENDER_ID=your_firebase_messaging_sender_id
   VITE_FIREBASE_APP_ID=your_firebase_app_id
   ```
4. Run `npm run dev` to start the development server.

## Running and Deployment
- **Frontend**: Run `npm run dev` for development or `npm run build` followed by `npm run preview` for production build.
- **Cloud Functions**: (If applicable) Navigate to the `functions/` directory, run `npm install`, and use `firebase deploy --only functions` to deploy.
