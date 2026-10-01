import React from 'react';
import './LoadingScreen.css';
import barangayLogo from '../../../assets/icons/Barangay_eng-hill.png';

interface LoadingScreenProps {
  fullScreen?: boolean;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  fullScreen = true
}) => {
  return (
    <div className={`eng-seal-loader-container ${fullScreen ? 'fullscreen' : 'embedded'}`}>
      <div className="seal-stage">
        <svg viewBox="0 0 500 500">
          <defs>
            {/* Top Text Arc (Clockwise over the top, center = 250,250, R = 188) */}
            <path id="text-arc-top" d="M 62,250 A 188,188 0 1,1 438,250" />
            
            {/* Bottom Text Arc (Clockwise along bottom, sweep=0 so letters stand upright, center = 250,250, R = 184) */}
            <path id="text-arc-bottom" d="M 66,250 A 184,184 0 0,0 434,250" />

            {/* Center Emblem Precision Crop Mask (R = 141) */}
            <clipPath id="center-crop-mask">
              <circle cx="250" cy="250" r="141" />
            </clipPath>
          </defs>

          {/* Concentric Outer Framing Rings */}
          <circle className="draw-stroke w-thick" cx="250" cy="250" r="238" />
          <circle className="draw-stroke w-fine"  cx="250" cy="250" r="226" />
          <circle className="draw-stroke w-fine"  cx="250" cy="250" r="152" />
          <circle className="draw-stroke w-thick" cx="250" cy="250" r="142" />

          {/* Side Ring Accent Pivot Nodes */}
          <circle className="draw-stroke w-medium" cx="61"  cy="250" r="7" />
          <circle className="draw-stroke w-medium" cx="439" cy="250" r="7" />

          {/* Cropped Center Emblem (Precision zoom & center alignment) */}
          <image 
            className="cropped-center-img"
            href={barangayLogo} 
            x="32" 
            y="32" 
            width="436" 
            height="436" 
            clipPath="url(#center-crop-mask)"
            preserveAspectRatio="xMidYMid slice"
          />

          {/* Top Curved Outlined Typography */}
          <text className="outlined-text">
            <textPath href="#text-arc-top" startOffset="50%" textAnchor="middle">
              ENGINEERS HILL BARANGAY
            </textPath>
          </text>

          {/* Bottom Curved Outlined Typography (Upright Reading Direction) */}
          <text className="outlined-text text-bottom">
            <textPath href="#text-arc-bottom" startOffset="50%" textAnchor="middle">
              BAGUIO CITY
            </textPath>
          </text>
        </svg>
      </div>
    </div>
  );
};

export default LoadingScreen;
