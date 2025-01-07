import React, { useState, useRef, useEffect } from 'react';
import { Auth } from 'aws-amplify';
import { getCloudFrontDomain } from '../config/amplify-config';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-provider-cognito-identity';
import { CognitoIdentityClient } from '@aws-sdk/client-cognito-identity';
import VideoPopover from './VideoPopover';
import './Chat.css';

// Utility function to convert time
const convertTime = (stime) => {
  if (!stime) return '';
  
  // Remove XML tags if present
  const cleanTime = stime.replace(/<\/?timestamp>/g, '');
  
  // Check if the string contains any numbers
  if (!(/\d/.test(cleanTime))) {
    return cleanTime;
  }

  // If cleanTime is not a number, return as is
  if (isNaN(cleanTime)) {
    return cleanTime;
  }

  // Convert seconds to MM:SS format
  const minutes = Math.floor(parseInt(cleanTime) / 60);
  const seconds = parseInt(cleanTime) % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const parseMetadata = (metadataLines) => {
  const parsed = {};
  let currentFile = null;

  metadataLines.forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('<location>')) {
      currentFile = trimmedLine.replace(/<\/?location>/g, '');
      parsed[currentFile] = [];
    } else if (trimmedLine.startsWith('<timestamp>')) {
      const timestamp = trimmedLine.replace(/<\/?timestamp>/g, '');
      if (currentFile) {
        parsed[currentFile].push(timestamp);
      }
    }
  });

  return parsed;
};

const parseTimestamps = (answer, parsedMetadata) => {
  const hasVideo = Object.keys(parsedMetadata).some(key => key.includes('.txt'));
  
  if (hasVideo) {
    // Handle single timestamps [31], ranges [31-48], and comma-separated [32, 49]
    return answer.replace(/\[(\d+)(?:[-,]\s*\d+)*\]/g, (match, firstNumber) => {
      const convertedTime = convertTime(firstNumber);
      return `|||TIMESTAMP:${firstNumber}:${convertedTime}|||`;
    });
  } else {
    return answer.replace(/\[[^\]]*\]/g, '');
  }
};

const getFileUrl = (metadata) => {
  const txtFile = Object.keys(metadata).find(key => key.includes('.txt'));
  if (txtFile) {
    const videoName = txtFile.split('/').pop().replace('.txt', '');
    return `https://${getCloudFrontDomain()}.cloudfront.net/${videoName}.mp4`;
  }
  return '';
};

   
const Chat = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [parsedMetadata, setParsedMetadata] = useState({});
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const getLambdaClient = async () => {
    try {
      // Get current authenticated session
      const session = await Auth.currentSession();
      const token = session.getIdToken().getJwtToken();

      // Initialize Lambda client with Cognito credentials
      return new LambdaClient({
        region: process.env.REACT_APP_AWS_REGION,
        credentials: fromCognitoIdentityPool({
          client: new CognitoIdentityClient({ 
            region: process.env.REACT_APP_AWS_REGION 
          }),
          identityPoolId: process.env.REACT_APP_IDENTITY_POOL_ID,
          logins: {
            [`cognito-idp.${process.env.REACT_APP_AWS_REGION}.amazonaws.com/${process.env.REACT_APP_USER_POOL_ID}`]: token
          }
        })
      });
    } catch (error) {
      console.error('Error getting Lambda client:', error);
      throw new Error('Failed to initialize AWS client');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);

    // Add user message to chat immediately
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    try {
      const lambda = await getLambdaClient();
      
      const payload = {
        question: userMessage,
        messages: [{
          role: 'user',
          content: [{ text: userMessage }]
        }]
      };

      console.log('Sending payload:', payload);

      const command = new InvokeCommand({
        FunctionName: process.env.REACT_APP_LAMBDA_FUNCTION_NAME,
        Payload: JSON.stringify(payload)
      });

      const response = await lambda.send(command);
      console.log('Raw Lambda response:', response);

      if (response.FunctionError) {
        throw new Error(`Lambda function error: ${response.FunctionError}`);
      }

      const result = JSON.parse(new TextDecoder().decode(response.Payload));
      console.log('Parsed response:', result);

      if (result.statusCode !== 200) {
        throw new Error(`API error: ${result.body}`);
      }

      const content = result.body.answer.content[0].text;
      console.log('Content received:', content); // Debug log

      if (content.includes('</answer>')) {
        const [answerText, metadataText] = content.split('<answer>')[1].split('</answer>');
        console.log('Answer text:', answerText); // Debug log
        console.log('Metadata text:', metadataText); // Debug log
        
        const metadata = parseMetadata(metadataText.split('\n'));
        console.log('Parsed metadata:', metadata); // Debug log
        
        setParsedMetadata(metadata);
        const parsedAnswer = parseTimestamps(answerText, metadata);
        console.log('Parsed answer:', parsedAnswer); // Debug log
        
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: parsedAnswer,
          metadata: metadata
        }]);
      } else {
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: content 
        }]);
      }
    } catch (error) {
      console.error('Error processing message:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${error.message}. Please try again or contact support if the problem persists.`
      }]);
    } finally {
      setIsLoading(false);
    }
  };


  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };
  
    const renderMessage = (message) => {
        if (message.role === 'user') {
        return <div className="message-content">{message.content}</div>;
        }

        // Add debug logs here
        console.log('Message metadata type:', typeof message.metadata);
        console.log('Message content value:', message.metadata);
        
        const parts = message.content.split('|||');
        const renderedContent = parts.map((part, index) => {
            if (part.startsWith('TIMESTAMP:')) {
                const seconds = parseInt(part.replace('TIMESTAMP:', ''), 10);
                
                // Convert seconds to MM:SS format
                const minutes = Math.floor(seconds / 60);
                const remainingSeconds = seconds % 60;
                const displayTime = `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;

                if (message.metadata) {
                    const txtFile = Object.keys(message.metadata).find(key => key.includes('.txt'));
                    if (txtFile) {
                        const videoUrl = getFileUrl(message.metadata);
                        return (
                            <VideoPopover
                                key={`inline-${index}`}
                                videoUrl={videoUrl}
                                timestamp={seconds}
                                displayTime={displayTime}
                            />
                        );
                    }
                }
                return displayTime;
            }
            return part;
        });
        

        // Handle Know More buttons from metadata
        let additionalContent = null;
        if (message.metadata && Object.keys(message.metadata).length > 0) {
            const uniqueLocations = new Set(); // To handle duplicates
            
            additionalContent = Object.keys(message.metadata)
                .map((location, index) => {
                    // Skip txt files
                    if (location.includes('.txt')) {
                        return null;
                    }
                    
                    // Avoid duplicates
                    if (!uniqueLocations.has(location)) {
                        uniqueLocations.add(location);
                        const fileName = location.split('/').pop(); // Get the file name
                        const url = `https://${getCloudFrontDomain()}.cloudfront.net/${fileName}`;
                        
                        return (
                            <button 
                                key={index} 
                                className="know-more-button"
                                onClick={() => window.open(url, '_blank')}
                            >
                                Know More...
                            </button>
                        );
                    }
                    return null;
                })
                .filter(Boolean); // Remove null values
        }

        return (
        <div className="message-content">
            {renderedContent}
            {additionalContent && (
                <div className="additional-content">
                    {additionalContent}
                </div>
            )}
        </div>
        );
    };
  
  
  return (
    <div className="chat-container">
      <div className="messages">
        {messages.length === 0 && (
          <div className="welcome-message">
            Welcome! How can I help you today?
          </div>
        )}
        {messages.map((message, index) => (
          <div key={index} className={`message ${message.role}`}>
            {renderMessage(message)}
          </div>
        ))}
        {isLoading && (
          <div className="message assistant">
            <div className="loading-indicator">
              <span>●</span><span>●</span><span>●</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      
      <form onSubmit={handleSubmit} className="input-form">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Type your message here..."
          disabled={isLoading}
          rows={1}
          className="message-input"
        />
        <button 
          type="submit" 
          disabled={isLoading || !input.trim()}
          className="send-button"
        >
          {isLoading ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
};

export default Chat;