import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Input, Select, TimePicker, DatePicker, Space, Typography, message } from 'antd';
import { CalendarOutlined, ClockCircleOutlined, UserOutlined, FileTextOutlined, PlusOutlined } from '@ant-design/icons';
import { ScheduleSlot } from '../../utils/schedulerView';

const { Text } = Typography;

interface AddSlotModalProps {
  visible: boolean;
  queueId: string;
  officers: any[];
  onSave: (slot: any) => Promise<void>;
  onCancel: () => void;
  onClose: () => void;
}

const AddSlotModal: React.FC<AddSlotModalProps> = ({
  visible,
  queueId,
  officers,
  onSave,
  onCancel,
  onClose,
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      form.resetFields();
    }
  }, [visible, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      
      const formattedValues = {
        queue_id: queueId,
        scheduled_date: values.scheduled_date?.toISOString().split('T')[0],
        window_start: values.window_start ? values.window_start.toTimeString().split(' ')[0].substring(0, 5) : null,
        window_end: values.window_end ? values.window_end.toTimeString().split(' ')[0].substring(0, 5) : null,
        officer_id: values.officer_id,
        window_label: values.window_label,
        notify_before_secs: values.notify_before_secs ?? 1800,
      };

      setLoading(true);
      await onSave(formattedValues);
      message.success('New slot added successfully');
      form.resetFields();
      onClose();
    } catch (error) {
      console.error('Failed to add slot:', error);
      message.error('Failed to add slot. Please check for scheduling conflicts.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={
        <span>
          <PlusOutlined /> Add New Attempt Slot
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
          label={<span><FileTextOutlined /> Focus / Label (Optional)</span>}
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

export default AddSlotModal;
