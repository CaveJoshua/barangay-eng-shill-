import type { DocumentSchema, DocumentPayload, RenderInstruction } from '../PDF_Algorithm';

import brgyLogo from '../icons/Barangay_eng-hill.png';

export const JobseekerSchema: DocumentSchema = {
  compile: (payload: DocumentPayload): RenderInstruction[] => {

    const dateObj = new Date(payload.dateIssued);
    const day = dateObj.getDate();
    const month = dateObj.toLocaleString('default', { month: 'long' });
    const year = dateObj.getFullYear();
    const suffix =
      day >= 11 && day <= 13
        ? 'th'
        : day % 10 === 1
        ? 'st'
        : day % 10 === 2
        ? 'nd'
        : day % 10 === 3
        ? 'rd'
        : 'th';

    // Use the kagawadName already resolved by the engine from the API
    const resolvedKagawad =
      (payload.kagawadName || '').toUpperCase() || 'BARANGAY KAGAWAD';

    return [
     
      // 2. Certificate number — top-right, before the header logo
      {
        type: 'text',
        content: `Barangay Certificate No. : ${payload.certificateNo}`,
        fontSize: 10,
        align: 'right',
        isBold: true,
      },
      { type: 'spacer', heightInMm: 20 },

      // 3. Logo + stacked text header (matches the physical document exactly)
      //    brgyLogo on the left, header text centred in the remaining space
      {
        type: 'logo_text_header',
        logoSrc: brgyLogo,
        logoSize: 22,
        heightInMm: 20,
        alignOffset: -14,
        headerLines: [
          { content: 'Republic of the Philippines', fontSize: 10, isBold: false },
          { content: "ENGINEER'S HILL BARANGAY",   fontSize: 14, isBold: true  },
          { content: 'Baguio City',                 fontSize: 10, isBold: false },
          { content: '074-422-8228',                fontSize: 10, isBold: false },
          { content: 'Email Address: engrshill2600@gmail.com', fontSize: 10, isBold: false },
        ],
      },
      { type: 'spacer', heightInMm: 4 },

      // 4. Titles
      {
        type: 'title',
        content: 'BARANGAY CERTIFICATION',
        fontSize: 16,
        align: 'center',
        isBold: true,
      },
      {
        type: 'text',
        content: '(FIRST TIME JOBSEEKERS ASSISTANCE ACT – RA 11261)',
        fontSize: 10,
        align: 'center',
        isBold: true,
      },
      { type: 'spacer', heightInMm: 10 },

      // 5. Body paragraphs
      {
        type: 'text',
        content: `This is to certify that <b>${payload.residentName}</b>, a resident of <b>${payload.address}</b>, Engineer's Hill, Baguio City for <b><u>&nbsp;One Year&nbsp;</u></b>, is a qualified availee of RA 11261 or the <b>First time Jobseekers Act of 2019</b>.`,
        fontSize: 11,
        align: 'justify',
      },
      { type: 'spacer', heightInMm: 5 },

      {
        type: 'text',
        content: `I further certify that the holder/bearer was informed of his/her rights, including the duties and responsibilities accorded by RA 11261 through the <b>Oath of Undertaking</b> he/she has signed and executed in the presence of our Barangay Official.`,
        fontSize: 11,
        align: 'justify',
      },
      { type: 'spacer', heightInMm: 5 },

      {
        type: 'text',
        content: `Signed this ${day}${suffix} day of ${month} ${year} at Engineer's Hill Barangay, Baguio City.`,
        fontSize: 11,
        align: 'justify',
      },
      { type: 'spacer', heightInMm: 4 },

      {
        type: 'text',
        content: `This certification is valid only One (1) year from the issuance.`,
        fontSize: 11,
        align: 'justify',
      },
      { type: 'spacer', heightInMm: 12 },

      // 6. Signature block — empty left column, all signatures centred in right column
      {
        type: 'columns',
        heightInMm: 48,
        columns: [
          { align: 'left', lines: [] },
          {
            align: 'center',
            lines: [
              { content: payload.captainName.toUpperCase(), isBold: true,  fontSize: 11 },
              { content: 'PUNONG BARANGAY',                 isBold: false, fontSize: 10 },
              {
                content: `${month} ${String(day).padStart(2, '0')}, ${year}`,
                isBold: false,
                fontSize: 10,
              },
              { content: '&nbsp;',          isBold: false, fontSize: 6  },
              { content: 'Witnessed by:',   isBold: false, fontSize: 10 },
              { content: '&nbsp;',          isBold: false, fontSize: 6  },
              { content: resolvedKagawad,   isBold: true,  fontSize: 11 },
              { content: 'BARANGAY KAGAWAD', isBold: false, fontSize: 10 },
              {
                content: `${month} ${day}, ${year}`,
                isBold: false,
                fontSize: 10,
              },
            ],
          },
        ],
      },

      // 7. Stamp box
      { type: 'spacer', heightInMm: 4 },
      {
        type: 'stamp_box',
        content: '"DOCUMENTARY STAMP TAX PAID"',
        orNo: payload.orNo || 'OR123',
        date: `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`,
        heightInMm: 25,
      },
      { type: 'spacer', heightInMm: 12 },

      // 8. Footer notes
      {
        type: 'text',
        content: 'THIS FORM NEED NOT BE NOTARIZED',
        fontSize: 10,
        isBold: true,
        align: 'left',
      },
      { type: 'text', content: '11261 Form 1', fontSize: 10, align: 'left', isBold: false },

      // ════════════════════════════════════════════════════════════════════
      // PAGE 2 — OATH OF UNDERTAKING
      // ════════════════════════════════════════════════════════════════════
      { type: 'page_break' },

      { type: 'text', content: 'Revised as of 16 June 2021', fontSize: 9, align: 'right' },
      { type: 'spacer', heightInMm: 8 },

      {
        type: 'title',
        content: 'OATH OF UNDERTAKING',
        fontSize: 14,
        align: 'center',
        isBold: true,
      },
      {
        type: 'text',
        content: 'Republic Act 11261 – First Time Jobseekers Assistance Act',
        fontSize: 10,
        align: 'center',
      },
      { type: 'spacer', heightInMm: 8 },

      {
        type: 'text',
        content: `I, <b>${payload.residentName}</b>, ____ years of age, resident of <b>${payload.address}</b>, Engineer's Hill, Baguio City for ____ Years, availing the benefits of <b>Republic Act 11261</b>, otherwise known as the <b>First Time Jobseekers Act of 2019</b>, do hereby declare, agree and undertake to abide and be bound by the following:`,
        fontSize: 10,
        align: 'justify',
      },
      { type: 'spacer', heightInMm: 5 },

      { type: 'text', content: `&nbsp;&nbsp;1.&nbsp; That this is the first time that I will actively look for a job, and therefore requesting that a Barangay Certification be issued in my favor to avail the benefits of the law;`, fontSize: 10, align: 'justify' },
      { type: 'text', content: `&nbsp;&nbsp;2.&nbsp; That I am aware that the benefit and privilege/s under the said law shall be valid only for one (1) year from the date that the Barangay Certification is issued;`, fontSize: 10, align: 'justify' },
      { type: 'text', content: `&nbsp;&nbsp;3.&nbsp; That I can avail the benefits of the law only once;`, fontSize: 10, align: 'justify' },
      { type: 'text', content: `&nbsp;&nbsp;4.&nbsp; That I understand that my personal information shall be included in the Roster /List of First Time Jobseekers and will not be used for any unlawful purpose;`, fontSize: 10, align: 'justify' },
      { type: 'text', content: `&nbsp;&nbsp;5.&nbsp; That I will inform and/or report to the Barangay personally, through text or other means, or through my family/relatives once I get employed;`, fontSize: 10, align: 'justify' },
      { type: 'text', content: `&nbsp;&nbsp;6.&nbsp; That I am not a beneficiary of the Job start Program under R.A. No. 10869 and other laws that give similar exemptions for the documents or transactions exempted under R.A No. 11261;`, fontSize: 10, align: 'justify' },
      { type: 'text', content: `&nbsp;&nbsp;7.&nbsp; That if issued the requested Certification, I will not use the same in any fraud, neither falsify nor help and/or assist in the fabrication of the said certification;`, fontSize: 10, align: 'justify' },
      { type: 'text', content: `&nbsp;&nbsp;8.&nbsp; That this undertaking is made solely for the purpose of obtaining a Barangay Certification consistent with the objective of R.A No. 11261 and not for any other purpose; and`, fontSize: 10, align: 'justify' },
      { type: 'text', content: `&nbsp;&nbsp;9.&nbsp; That I consent to the use of my personal information pursuant to the Data Privacy Act and other applicable laws, rules and regulations.`, fontSize: 10, align: 'justify' },
      { type: 'spacer', heightInMm: 6 },

      {
        type: 'text',
        content: `Signed this ${day}${suffix} day of ${month} ${year} in the Engineer's Hill Barangay, Baguio City.`,
        fontSize: 10,
        align: 'justify',
      },
      { type: 'spacer', heightInMm: 8 },

      {
        type: 'columns',
        heightInMm: 20,
        columns: [
          {
            align: 'left',
            lines: [
              { content: 'Signed by:',                      isBold: false, fontSize: 10 },
              { content: '&nbsp;',                          isBold: false, fontSize: 10 },
              { content: payload.residentName.toUpperCase(), isBold: true,  fontSize: 10 },
              { content: 'First Time Jobseeker',            isBold: false, fontSize: 10 },
            ],
          },
          {
            align: 'right',
            lines: [
              { content: 'Witnessed by:',                    isBold: false, fontSize: 10 },
              { content: '&nbsp;',                           isBold: false, fontSize: 10 },
              { content: payload.captainName.toUpperCase(),  isBold: true,  fontSize: 10 },
              { content: 'Punong Barangay',                  isBold: false, fontSize: 10 },
            ],
          },
        ],
      },
      { type: 'spacer', heightInMm: 8 },

      {
        type: 'text',
        content: 'For applicants at least fifteen years old to less than 18 years of age:',
        fontSize: 10,
        isBold: true,
        align: 'left',
      },
      { type: 'spacer', heightInMm: 4 },
      {
        type: 'text',
        content: `I, ___________________________________, _____ years of age, parent/guardian of ___________________________________, and a resident of __________________________________________________ (complete address), for _______ (years/months), do hereby give my consent for my child/dependent to avail the benefits of <b>Republic Act 11261</b> and be bound by the abovementioned conditions.`,
        fontSize: 10,
        align: 'justify',
      },
      { type: 'spacer', heightInMm: 10 },

      {
        type: 'columns',
        heightInMm: 18,
        columns: [
          {
            align: 'center',
            lines: [
              { content: 'Signed by: ______________________________', isBold: false, fontSize: 10 },
              { content: 'Parent/Guardian',                           isBold: true,  fontSize: 10 },
            ],
          },
          { align: 'right', lines: [] },
        ],
      },
      { type: 'spacer', heightInMm: 8 },

      {
        type: 'text',
        content: 'THIS FORM NEED NOT BE NOTARIZED',
        fontSize: 10,
        isBold: true,
        align: 'left',
      },
      { type: 'text', content: '11261 Form 2', fontSize: 10, align: 'left', isBold: false },
    ];
  },
};