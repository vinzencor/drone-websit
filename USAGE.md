# Quick Start Guide - Horizon Drone Hero Section

## What's Been Integrated

A fully functional 3D hero section with:
- **6 animated drone images** from Unsplash
- **Black background** throughout
- **Smooth scroll animations** through 3 sections
- **Parallax effects** on all images
- **Camera movements** that follow scroll progress
- **Professional typography** and UI overlays

## How to Use

### 1. Start Development Server
```bash
npm run dev
```

### 2. View the Component
Open your browser and navigate to the local development URL (usually `http://localhost:5173`)

### 3. Scroll to Experience
Scroll down the page to see:
- Camera moving through the drone images
- Parallax effects on different layers
- Smooth transitions between sections
- Images fading out near the end

## Component Structure

```
/src
  /components
    /ui
      horizon-hero-section.tsx  ← Main component
  /pages
    demo.tsx                     ← Standalone demo page
  App.tsx                        ← Using the component
```

## Customization Quick Reference

### Change Background Color
In `horizon-hero-section.tsx`, line 41:
```typescript
refs.scene.background = new THREE.Color(0x000000); // Change hex color
```

### Add More Drone Images
In `horizon-hero-section.tsx`, around line 72:
```typescript
const droneImages = [
  // Add more Unsplash URLs here
  'https://images.unsplash.com/photo-YOUR-IMAGE-ID?w=1200&q=80',
];
```

### Adjust Scroll Speed
In `horizon-hero-section.tsx`, around line 255:
```typescript
const parallaxSpeed = 0.5 + i * 0.3; // Increase multiplier for faster scroll
```

### Change Section Count
In `horizon-hero-section.tsx`, line 23:
```typescript
const totalSections = 2; // Increase for more sections
```
Then add corresponding sections in the JSX (around line 317)

### Modify Text Content
In `horizon-hero-section.tsx`, around line 294 and 318:
```typescript
// Main title
<h1>YOUR TITLE</h1>

// Subtitle lines
<p>Your first line</p>
<p>Your second line</p>
```

## Responsive Behavior

The component automatically adjusts for:
- **Desktop**: Full 3D experience with large text
- **Tablet**: Scaled down elements
- **Mobile**: Optimized performance, responsive text sizes

## Performance Tips

### For Production
1. **Optimize Images**: Compress drone images before using
2. **Code Splitting**: Consider lazy loading the component
3. **Reduce Quality**: Lower `devicePixelRatio` for better mobile performance

### In Development
- Component hot-reloads automatically
- Changes to text/styles reflect immediately
- 3D scene resets on component reload

## Troubleshooting

### Black Screen on Load
- Check browser console for WebGL errors
- Ensure browser supports WebGL
- Try disabling browser extensions

### Images Not Loading
- Check network tab for 404 errors
- Verify Unsplash URLs are valid
- Images load asynchronously, may take a moment

### Slow Performance
- Reduce `devicePixelRatio` in renderer setup
- Decrease number of drone images
- Lower image resolution

### Animation Not Smooth
- Close other browser tabs
- Check CPU usage
- Disable browser hardware acceleration and re-enable

## Files Modified

1. **Created**: `/src/components/ui/horizon-hero-section.tsx`
2. **Created**: `/src/pages/demo.tsx`
3. **Updated**: `/src/App.tsx` - Now renders the component
4. **Updated**: `/src/App.css` - Removed constraints
5. **Updated**: `/src/index.css` - Set black background

## Dependencies Added

```json
{
  "dependencies": {
    "gsap": "^latest",
    "three": "^latest"
  },
  "devDependencies": {
    "@types/three": "^latest"
  }
}
```

## Next Steps

1. **Add More Sections**: Extend the scroll experience
2. **Custom Drone Images**: Replace with your own photography
3. **Interactive Elements**: Add click handlers to images
4. **Dynamic Content**: Connect to a CMS or database
5. **Performance Monitoring**: Add analytics for scroll depth

## Support

For issues with:
- **Three.js**: https://threejs.org/docs/
- **GSAP**: https://greensock.com/docs/
- **Tailwind CSS**: https://tailwindcss.com/docs

Enjoy your immersive drone hero section!
