import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Input, Select, TimePicker, DatePicker, Space, Typography, message } from 'antd';
import { CalendarOutlined, ClockCircleOutlined, UserOutlined, FileTextOutlined } from '@ant-design/icons';
import { ScheduleSlot } from '../../utils/schedulerView';

const { Text } = Typography;

interface EditSlotModalProps {
  visible: boolean;
  slot: ScheduleSlot;
  officers: any[];
  onSave: (slot: ScheduleSlot) => Promise<void>;
  onCancel: () => void;
  onClose: () => void;
}

const EditSlotModal: React.FC<EditSlotModalProps> = ({
  visible,
  slot,
  officers,
  onSave,
  onCancel,
  onClose,
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible && slot) {
      form.setFieldsValue({
        ...slot,
        scheduled_date: slot.scheduled_date ? new Date(slot.scheduled_date) : null,
        window_start: slot.window_start ? new Date(`1970-01-01T${slot.window_start}:00`) : null,
        window_end: slot.window_end ? new Date(`1970-01-01T${slot.window_end}:00`) : null,
        notify_before_secs: slot.notify_before_secs ?? 1800,
      });
    }
  }, [visible, slot, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      
      // Convert back to string formats for backend
      const formattedValues = {
        ...values,
        scheduled_date: values.scheduled_date?.toISOString().split('T')[0],
        window_start: values.window_start ? values.window_start.toTimeString().split(' ')[0].substring(0, 5) : null,
        window_end: values.window_end ? values.window_end.toTimeString().split(' ')[0].substring(0, 5) : null,
      };

      setLoading(true);
      await onSave(formattedValues as any);
      message.success('Slot updated successfully');
      form.resetFields();
      onClose();
    } catch (error) {
      console.error('Failed to save slot:', error);
      message.error('Failed to update slot. Please check for conflicts.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={
        <span>
          <EditIcon /> Edit Attempt Slot #{slot.attempt}
        </span>
      }
      open={visible}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      destroyOnClose
      width={600}
    >
      <Form form={form} layout="vertical" initialValues={{ notify_before_secs: 1800 }}>
        <Form.Item
          name="scheduled_date"
          label={<span><CalendarOutlined /> Scheduled Date</span>}
          rules={[{ required: true, message: 'Please select a date' }]}
        >
          <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
        </Form.Item>

        <div style={{ display: 'flex', gap: '16px' }}>
          <Form.Item
            name="window_start"
            label={<span><ClockCircleOutlined /> Window Start</span>}
            rules={[{ required: true, message: 'Required' }]}
            style={{ flex: 1 }}
          >
            <TimePicker format="HH:mm" style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="window_end"
            label={<span><ClockCircleOutlined /> Window End</span>}
            rules={[{ required: true, message: 'Required' }]}
            style={{ flex: 1 }}
          >
            <TimePicker format="HH:mm" style={{ width: '100%' }} />
          </Form.Item>
        </div>

        <Form.Item
          name="officer_id"
          label={<span><UserOutlined /> Assigned Officer</span>}
          rules={[{ required: true, message: 'Please assign an officer' }]}
        >
          <Select placeholder="Select an officer" optionFilterProp="label">
            {officers.map((o) => (
              <Select.Option key={o.id} value={o.id} label={o.name}>
                {o.name}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="window_label"
          label={<span><FileTextOutlined /> Focus / Label</span>}
        >
          <Input placeholder="e.g. Evening - High Residential Hit Rate" />
        </Form.Item>

        <Form.Item
          name="notify_before_secs"
          label="Notify Before Window (seconds)"
        >
          <Select
            options={[
              { value: 900, label: '15 mins' },
              { value: 1800, label: '30 mins' },
              { value: 3600, label: '1 hour' },
              { value: 7200, label: '2 hours' },
              { value: 14400, label: '4 hours' },
              { value: 21600, label: '6 hours' },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

const EditIcon = () => (
  <span style={{ marginRight: '8px' }}>📝</span>
);

export default EditSlotModal;
