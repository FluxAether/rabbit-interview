import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'

// Register core plugins
if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger, useGSAP)
  gsap.defaults({
    duration: 0.6,
    ease: 'power2.out',
  })
}

export { gsap, ScrollTrigger, useGSAP }
