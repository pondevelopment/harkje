import { OrgNode } from './types';

export const INITIAL_DATA: OrgNode = {
  id: '1',
  name: 'Sarah Connor',
  title: 'CEO',
  department: 'Executive',
  details: 'Visionary leader focusing on long-term strategy.',
  children: [
    {
      id: '2',
      name: 'Kyle Reese',
      title: 'VP of Engineering',
      department: 'Technology',
      details: 'Oversees all technical development and infrastructure.',
      children: [
        {
          id: '4',
          name: 'T-800',
          title: 'Lead Architect',
          department: 'Technology',
          details: 'Systems architecture and security protocols.',
          children: []
        },
        {
          id: '5',
          name: 'Marcus Wright',
          title: 'DevOps Manager',
          department: 'Technology',
          details: 'CI/CD pipelines and cloud infrastructure.',
          children: []
        }
      ]
    },
    {
      id: '3',
      name: 'John Connor',
      title: 'VP of Operations',
      department: 'Operations',
      details: 'Daily operations and resistance planning.',
      children: [
        {
          id: '6',
          name: 'Kate Brewster',
          title: 'HR Director',
          department: 'Human Resources',
          details: 'Recruitment and personnel management.',
          children: []
        }
      ]
    }
  ]
};