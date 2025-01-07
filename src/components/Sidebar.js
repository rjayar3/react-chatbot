import React, { useState } from 'react';
import { Storage } from 'aws-amplify';
import './Sidebar.css';

const Sidebar = ({ isCollapsed, onToggleCollapse }) => {
  const [uploadStatus, setUploadStatus] = useState([]);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files);
    setIsUploading(true);

    for (const file of files) {
      try {
        const result = await Storage.put(file.name, file, {
          contentType: file.type,
          level: 'public',
          customPrefix: {
            public: ''
          }
        });
        
        setUploadStatus(prev => [...prev, `✅ Successfully uploaded ${file.name}`]);
      } catch (error) {
        console.error('Upload error:', error);
        setUploadStatus(prev => [...prev, `❌ Failed to upload ${file.name}: ${error.message}`]);
      }
    }

    setIsUploading(false);
    event.target.value = '';
  };

  return (
    <>
      <div className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-content">
          <h2>Content Upload</h2>
          
          <div className="upload-section">
            <input
              type="file"
              onChange={handleFileUpload}
              multiple
              disabled={isUploading}
              className="file-input"
            />
            {isUploading && <div className="upload-progress">Uploading...</div>}
          </div>

          {uploadStatus.length > 0 && (
            <div className="upload-history">
              <h3>Upload History</h3>
              <ul>
                {uploadStatus.map((status, index) => (
                  <li key={index}>{status}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      <button 
        className="sidebar-toggle"
        onClick={onToggleCollapse}
      >
        {isCollapsed ? '→' : '←'}
      </button>
    </>
  );
};

export default Sidebar;