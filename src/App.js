import React from 'react';
import AuthWrapper from './components/AuthWrapper';
import './App.css';
import '@aws-amplify/ui-react/styles.css';

function App() {
  return (
    <div className="App">
      <AuthWrapper />
    </div>
  );
}

export default App;