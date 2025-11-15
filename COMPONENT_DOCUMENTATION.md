# Horizon Hero Section - Drone Animation Component

## Overview
An immersive 3D hero section featuring animated drone imagery with smooth scroll-based transitions and camera movements. Built with Three.js and GSAP.

## Features
- **3D Drone Images**: Six drone photographs displayed as 3D planes with parallax effects
- **Black Background**: Pure black (#000000) background for dramatic contrast
- **Scroll Animations**: Camera moves through scenes as user scrolls
- **Smooth Transitions**: GSAP-powered animations with easing
- **Parallax Effects**: Multiple layers of drone images moving at different speeds
- **Floating Animation**: Subtle floating motion for natural feel
- **Responsive Design**: Adapts to all screen sizes

## Installation

### Dependencies Installed
```bash
npm install gsap three
npm install --save-dev @types/three
```

## Component Structure

### File Location
- Component: `/src/components/ui/horizon-hero-section.tsx`
- Demo: `/src/pages/demo.tsx`
- Main App: Updated `/src/App.tsx`

### Key Elements
1. **3D Canvas**: Three.js renderer with WebGL
2. **Drone Images**: 6 Unsplash drone photos positioned in 3D space
3. **Camera**: Animated perspective camera with smooth movement
4. **Lighting**: Ambient, directional, and point lights
5. **UI Overlays**:
   - Side menu (left)
   - Hero title and subtitle (center)
   - Scroll progress indicator (bottom right)

## Drone Images Used
All images are from Unsplash:
1. `photo-1473968512647-3e447244af8f` - Aerial drone view
2. `photo-1507582020474-9a35b7d455d9` - Drone in flight
3. `photo-1508614999368-9260051292e5` - Drone landscape
4. `photo-1527977966376-1c8408f9f108` - Drone cityscape
5. `photo-1521405924368-64ab2e13d193` - Drone perspective
6. `photo-1506947411565-14e4e04e4a2f` - Drone aerial shot

## Scroll Behavior

### Sections
- **Section 0 (HORIZON)**: Initial view, camera at z:50
- **Section 1 (COSMOS)**: Mid-scroll, camera moves to z:-50
- **Section 2 (INFINITY)**: Final view, camera at z:-150

### Camera Movement
- Smooth easing between positions
- Subtle floating motion (sine/cosine waves)
- Parallax effect on drone images
- Images fade out at 70% scroll progress

### Parallax Speed
Each drone image moves at a different speed based on its index:
- Speed = 0.5 + (index * 0.3)
- Creates depth perception

## Customization

### Change Drone Images
Replace URLs in the `droneImages` array:
```typescript
const droneImages = [
  'your-image-url-1',
  'your-image-url-2',
  // ... more images
];
```

### Adjust Camera Positions
Modify the `cameraPositions` array:
```typescript
const cameraPositions = [
  { x: 0, y: 5, z: 50 },    // Start position
  { x: -10, y: 10, z: -50 }, // Middle
  { x: 5, y: 15, z: -150 }   // End
];
```

### Change Section Titles
Update the `titles` and `subtitles` arrays:
```typescript
const titles = ['YOUR_TITLE_1', 'YOUR_TITLE_2'];
const subtitles = [
  { line1: 'First line', line2: 'Second line' },
  // ...
];
```

## Performance Considerations

### Bundle Size
- Three.js adds ~756KB to bundle (minified)
- Consider code splitting for production:
  ```typescript
  const Component = lazy(() => import('@/components/ui/horizon-hero-section'));
  ```

### Optimization Tips
1. **Reduce Image Resolution**: Use appropriately sized images (1200px width)
2. **Limit Geometries**: Current setup uses 6 planes (optimal)
3. **Dispose Resources**: Component properly cleans up on unmount
4. **Smooth Scrolling**: Uses requestAnimationFrame for 60fps

## Browser Compatibility
- Modern browsers with WebGL support
- Chrome, Firefox, Safari, Edge (latest versions)
- Mobile devices with WebGL enabled

## Styling
Component uses Tailwind CSS for UI elements:
- Fixed positioning for overlays
- Z-index layering for depth
- Responsive text sizes (md: breakpoint)
- Custom visibility for GSAP animations

## Known Limitations
1. Requires WebGL-capable device
2. Large bundle size due to Three.js
3. Performance may vary on low-end devices
4. Images load from external URLs (network dependent)

## Future Enhancements
- Lazy load images for faster initial render
- Add loading states/progress
- Support for video textures
- Interactive camera controls
- Performance mode for mobile devices
- Dynamic content from CMS/database
